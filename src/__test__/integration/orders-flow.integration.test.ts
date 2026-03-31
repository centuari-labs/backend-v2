import { Test, TestingModule } from "@nestjs/testing";
import { HttpStatus } from "@nestjs/common";
import { DataSource, Repository } from "typeorm";
import { getRepositoryToken } from "@nestjs/typeorm";
import { OrdersService } from "../../orders/orders.service";
import { OrderRepository } from "../../orders/repositories/order.repository";
import { Order } from "../../orders/entities/order.entity";
import { OrderMarket } from "../../orders/entities/order-market.entity";
import { Account } from "../../orders/entities/account.entity";
import { Token } from "../../tokens/entities/token.entity";
import { Market } from "../../market/entities/market.entity";
import { TokensService } from "../../tokens/tokens.service";
import { NatsService } from "../../core/nats/nats.service";
import { PriceService } from "../../price/price.service";
import { MarketRepositories } from "../../market/repository/market.repository";
import { PortfolioService } from "../../portfolio/portfolio.service";
import {
    OrderSide,
    OrderType,
    OrderStatus,
} from "../../orders/constants/order.constants";
import {
    createMockOrder,
    createMockAccount,
    createMockMarket,
    createMockToken,
    MOCK_IDS,
} from "../helpers/mock-factories";
import {
    createMockNatsService,
    createMockPriceService,
    createMockMarketRepository,
    createMockPortfolioService,
} from "../helpers/mock-services";

/**
 * Integration tests for the order lifecycle flow.
 * Uses NestJS TestingModule with mocked external dependencies (DB, NATS, price)
 * but real service/repository wiring to test cross-layer interactions.
 */
describe("Orders Flow Integration", () => {
    let ordersService: OrdersService;
    let orderRepository: OrderRepository;
    let natsService: jest.Mocked<NatsService>;
    let tokensService: jest.Mocked<TokensService>;
    let priceService: jest.Mocked<PriceService>;
    let marketRepository: jest.Mocked<MarketRepositories>;
    let portfolioService: jest.Mocked<PortfolioService>;
    let accountRepository: jest.Mocked<Repository<Account>>;
    let dataSource: jest.Mocked<DataSource>;

    const mockMaturityDate = new Date("2025-06-01T00:00:00.000Z");

    beforeEach(async () => {
        const mockNats = createMockNatsService();
        const mockTokens = {
            validateTokenByAssetId: jest.fn().mockResolvedValue(undefined),
            getTokenDecimalsByAssetId: jest.fn().mockResolvedValue(6),
            getTokenByAssetId: jest.fn().mockResolvedValue(createMockToken()),
        } as any;
        const mockPrice = createMockPriceService();
        const mockMarkets = createMockMarketRepository();
        const mockPortfolio = createMockPortfolioService();

        const mockAccountRepo = {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            createQueryBuilder: jest.fn(),
        };

        const mockMetadata = {
            columns: [],
            relations: [],
            primaryColumns: [],
            target: Order,
            tableName: "orders",
            ownColumns: [],
            ownRelations: [],
            eagerRelations: [],
            lazyRelations: [],
            createValueMap: jest.fn(),
        };

        const mockQueryBuilder = {
            innerJoin: jest.fn().mockReturnThis(),
            leftJoin: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            andWhere: jest.fn().mockReturnThis(),
            orderBy: jest.fn().mockReturnThis(),
            select: jest.fn().mockReturnThis(),
            addSelect: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            offset: jest.fn().mockReturnThis(),
            getCount: jest.fn().mockResolvedValue(0),
            getOne: jest.fn().mockResolvedValue(null),
            getMany: jest.fn().mockResolvedValue([]),
        };

        const mockEntityManager = {
            getRepository: jest.fn(),
            findOne: jest.fn(),
            find: jest.fn(),
            save: jest.fn(),
            createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
            connection: {
                getMetadata: jest.fn().mockReturnValue(mockMetadata),
            },
        };

        const mockDs = {
            transaction: jest.fn(),
            createEntityManager: jest.fn().mockReturnValue(mockEntityManager),
            getMetadata: jest.fn().mockReturnValue(mockMetadata),
        };

        (mockMarkets as any).getMarketsByIds.mockResolvedValue([
            createMockMarket({
                id: MOCK_IDS.marketId,
                maturity: mockMaturityDate,
            }),
        ]);

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                OrdersService,
                OrderRepository,
                { provide: DataSource, useValue: mockDs },
                {
                    provide: getRepositoryToken(Account),
                    useValue: mockAccountRepo,
                },
                { provide: TokensService, useValue: mockTokens },
                { provide: NatsService, useValue: mockNats },
                { provide: PriceService, useValue: mockPrice },
                { provide: MarketRepositories, useValue: mockMarkets },
                { provide: PortfolioService, useValue: mockPortfolio },
            ],
        }).compile();

        ordersService = module.get<OrdersService>(OrdersService);
        orderRepository = module.get<OrderRepository>(OrderRepository);
        natsService = module.get(NatsService) as jest.Mocked<NatsService>;
        tokensService = module.get(TokensService) as jest.Mocked<TokensService>;
        priceService = module.get(PriceService) as jest.Mocked<PriceService>;
        marketRepository = module.get(
            MarketRepositories,
        ) as jest.Mocked<MarketRepositories>;
        portfolioService = module.get(
            PortfolioService,
        ) as jest.Mocked<PortfolioService>;
        accountRepository = module.get(
            getRepositoryToken(Account),
        ) as jest.Mocked<Repository<Account>>;
        dataSource = module.get(DataSource) as jest.Mocked<DataSource>;
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("Lend order lifecycle", () => {
        it("should create a lend limit order and publish to NATS", async () => {
            const dto = {
                assetId: MOCK_IDS.assetId,
                amount: "1000",
                marketIds: [MOCK_IDS.marketId],
                rate: 500,
            };
            const expectedOrder = createMockOrder({
                side: OrderSide.Lend,
                type: OrderType.Limit,
                rate: 500,
            });

            accountRepository.findOne.mockResolvedValue(null);
            accountRepository.create.mockReturnValue(createMockAccount());
            accountRepository.save.mockResolvedValue(createMockAccount());

            const mockOrderRepo = {
                save: jest.fn().mockResolvedValue(expectedOrder),
            };
            const mockOrderMarketRepo = {
                save: jest.fn().mockResolvedValue({}),
            };
            dataSource.transaction.mockImplementation(async (cb: any) => {
                const manager = {
                    getRepository: jest.fn((entity: any) => {
                        if (entity === Order) return mockOrderRepo;
                        if (entity === OrderMarket) return mockOrderMarketRepo;
                        return {};
                    }),
                };
                return cb(manager);
            });

            jest.spyOn(orderRepository, "create").mockReturnValue(
                expectedOrder,
            );

            const result = await ordersService.createLendLimitOrder(
                dto,
                MOCK_IDS.walletAddress,
                MOCK_IDS.privyUserId,
            );

            expect(result.statusCode).toBe(HttpStatus.CREATED);
            expect(result.data.side).toBe(OrderSide.Lend);
            expect(result.data.type).toBe(OrderType.Limit);
            expect(result.data.rate).toBe(5); // 500 BPS = 5%
            expect(natsService.publish).toHaveBeenCalledWith(
                "orders.lend.limit",
                expect.objectContaining({
                    orderId: MOCK_IDS.orderId,
                    side: OrderSide.Lend,
                    type: OrderType.Limit,
                }),
            );
        });

        it("should create a lend market order with rate=0", async () => {
            const dto = {
                assetId: MOCK_IDS.assetId,
                amount: "1000",
                marketIds: [MOCK_IDS.marketId],
            };
            const expectedOrder = createMockOrder({
                side: OrderSide.Lend,
                type: OrderType.Market,
                rate: 0,
            });

            accountRepository.findOne.mockResolvedValue(createMockAccount());

            const mockOrderRepo = {
                save: jest.fn().mockResolvedValue(expectedOrder),
            };
            const mockOrderMarketRepo = {
                save: jest.fn().mockResolvedValue({}),
            };
            dataSource.transaction.mockImplementation(async (cb: any) => {
                const manager = {
                    getRepository: jest.fn((entity: any) => {
                        if (entity === Order) return mockOrderRepo;
                        if (entity === OrderMarket) return mockOrderMarketRepo;
                        return {};
                    }),
                };
                return cb(manager);
            });

            jest.spyOn(orderRepository, "create").mockReturnValue(
                expectedOrder,
            );
            jest.spyOn(
                orderRepository,
                "hasCounterpartyOrders",
            ).mockResolvedValue(true);

            const result = await ordersService.createLendMarketOrder(
                dto,
                MOCK_IDS.walletAddress,
                MOCK_IDS.privyUserId,
            );

            expect(result.statusCode).toBe(HttpStatus.CREATED);
            expect(result.data.rate).toBe(0);
            expect(natsService.publish).toHaveBeenCalledWith(
                "orders.lend.market",
                expect.anything(),
            );
        });
    });

    describe("Borrow order lifecycle", () => {
        it("should create a borrow limit order when health factor is sufficient", async () => {
            const dto = {
                assetId: MOCK_IDS.assetId,
                amount: "5000",
                marketIds: [MOCK_IDS.marketId],
                rate: 750,
            };
            const expectedOrder = createMockOrder({
                side: OrderSide.Borrow,
                type: OrderType.Limit,
                rate: 750,
                quantity: "5000",
            });

            accountRepository.findOne.mockResolvedValue(createMockAccount());

            const mockOrderRepo = {
                save: jest.fn().mockResolvedValue(expectedOrder),
            };
            const mockOrderMarketRepo = {
                save: jest.fn().mockResolvedValue({}),
            };
            dataSource.transaction.mockImplementation(async (cb: any) => {
                const manager = {
                    getRepository: jest.fn((entity: any) => {
                        if (entity === Order) return mockOrderRepo;
                        if (entity === OrderMarket) return mockOrderMarketRepo;
                        return {};
                    }),
                };
                return cb(manager);
            });

            jest.spyOn(orderRepository, "create").mockReturnValue(
                expectedOrder,
            );

            const result = await ordersService.createBorrowLimitOrder(
                dto,
                MOCK_IDS.walletAddress,
                MOCK_IDS.privyUserId,
            );

            expect(result.statusCode).toBe(HttpStatus.CREATED);
            expect(result.data.side).toBe(OrderSide.Borrow);
            expect(natsService.publish).toHaveBeenCalledWith(
                "orders.borrow.limit",
                expect.anything(),
            );
        });

        it("should reject borrow when health factor is below 1", async () => {
            const dto = {
                assetId: MOCK_IDS.assetId,
                amount: "5000",
                marketIds: [MOCK_IDS.marketId],
                rate: 750,
            };

            accountRepository.findOne.mockResolvedValue(createMockAccount());
            (
                portfolioService.getHealthFactorForAccount as jest.Mock
            ).mockResolvedValueOnce({
                healthFactor: 0.5,
                collateralUsd: 500,
                debtUsd: 1000,
                weightedLtvDecimal: 0.75,
            });

            await expect(
                ordersService.createBorrowLimitOrder(
                    dto,
                    MOCK_IDS.walletAddress,
                    MOCK_IDS.privyUserId,
                ),
            ).rejects.toThrow("Borrow would reduce health factor below 1");
        });
    });

    describe("Cancel order flow", () => {
        it("should cancel an open order and publish to NATS", async () => {
            const openOrder = createMockOrder({
                id: "cancel-me",
                status: OrderStatus.Open,
            });
            const cancelledOrder = {
                ...openOrder,
                status: OrderStatus.Cancelled,
            };

            jest.spyOn(orderRepository, "getOrderById").mockResolvedValue(
                openOrder,
            );
            jest.spyOn(
                orderRepository,
                "findAccountByWallet",
            ).mockResolvedValue(createMockAccount({ id: openOrder.accountId }));
            jest.spyOn(orderRepository, "save").mockResolvedValue(
                cancelledOrder as Order,
            );

            const result = await ordersService.cancelOrder(
                "cancel-me",
                MOCK_IDS.walletAddress,
            );

            expect(result.status).toBe(OrderStatus.Cancelled);
            expect(natsService.publish).toHaveBeenCalledWith(
                "orders.cancel",
                expect.objectContaining({
                    orderId: "cancel-me",
                    walletAddress: MOCK_IDS.walletAddress,
                }),
            );
        });

        it("should reject cancel for non-existent order", async () => {
            jest.spyOn(orderRepository, "getOrderById").mockResolvedValue(null);

            await expect(
                ordersService.cancelOrder(
                    "nonexistent",
                    MOCK_IDS.walletAddress,
                ),
            ).rejects.toThrow();
        });

        it("should reject cancel by non-owner", async () => {
            const openOrder = createMockOrder({
                id: "not-mine",
                accountId: "other-account",
            });

            jest.spyOn(orderRepository, "getOrderById").mockResolvedValue(
                openOrder,
            );
            jest.spyOn(
                orderRepository,
                "findAccountByWallet",
            ).mockResolvedValue(
                createMockAccount({ id: MOCK_IDS.accountId }), // Different from order's accountId
            );

            await expect(
                ordersService.cancelOrder("not-mine", MOCK_IDS.walletAddress),
            ).rejects.toThrow();
        });
    });

    describe("Account creation flow", () => {
        it("should create account on first order then reuse on second", async () => {
            const dto = {
                assetId: MOCK_IDS.assetId,
                amount: "100",
                marketIds: [MOCK_IDS.marketId],
                rate: 300,
            };
            const account = createMockAccount();
            const expectedOrder = createMockOrder({
                side: OrderSide.Lend,
                type: OrderType.Limit,
            });

            // First call: account doesn't exist, gets created
            accountRepository.findOne.mockResolvedValueOnce(null);
            accountRepository.create.mockReturnValue(account);
            accountRepository.save.mockResolvedValue(account);

            const mockRepoFactory = () => {
                const mockOrderRepo = {
                    save: jest.fn().mockResolvedValue(expectedOrder),
                };
                const mockOrderMarketRepo = {
                    save: jest.fn().mockResolvedValue({}),
                };
                return {
                    getRepository: jest.fn((entity: any) => {
                        if (entity === Order) return mockOrderRepo;
                        if (entity === OrderMarket) return mockOrderMarketRepo;
                        return {};
                    }),
                };
            };

            dataSource.transaction.mockImplementation(async (cb: any) =>
                cb(mockRepoFactory()),
            );
            jest.spyOn(orderRepository, "create").mockReturnValue(
                expectedOrder,
            );

            await ordersService.createLendLimitOrder(
                dto,
                MOCK_IDS.walletAddress,
                MOCK_IDS.privyUserId,
            );

            expect(accountRepository.findOne).toHaveBeenCalledTimes(1);
            expect(accountRepository.create).toHaveBeenCalledTimes(1);

            // Second call: account exists
            jest.clearAllMocks();
            accountRepository.findOne.mockResolvedValueOnce(account);
            dataSource.transaction.mockImplementation(async (cb: any) =>
                cb(mockRepoFactory()),
            );
            jest.spyOn(orderRepository, "create").mockReturnValue(
                expectedOrder,
            );

            (marketRepository as any).getMarketsByIds.mockResolvedValue([
                createMockMarket({
                    id: MOCK_IDS.marketId,
                    maturity: mockMaturityDate,
                }),
            ]);
            (priceService as any).getPrice.mockResolvedValue(1);
            (tokensService as any).validateTokenByAssetId.mockResolvedValue(
                undefined,
            );
            (tokensService as any).getTokenDecimalsByAssetId.mockResolvedValue(
                6,
            );
            (tokensService as any).getTokenByAssetId.mockResolvedValue(
                createMockToken(),
            );

            await ordersService.createLendLimitOrder(
                dto,
                MOCK_IDS.walletAddress,
                MOCK_IDS.privyUserId,
            );

            expect(accountRepository.findOne).toHaveBeenCalledTimes(1);
            expect(accountRepository.create).not.toHaveBeenCalled();
        });
    });
});
