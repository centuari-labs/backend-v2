import { Test, TestingModule } from "@nestjs/testing";
import {
    BadRequestException,
    ForbiddenException,
    NotFoundException,
    HttpStatus,
} from "@nestjs/common";
import { OrdersService } from "../../orders/orders.service";
import { Order } from "../../orders/entities/order.entity";
import { Market } from "../../market/entities/market.entity";
import { MarketRepositories } from "../../market/repository/market.repository";
import { PriceService } from "../../price/price.service";
import { TokensService } from "../../tokens/tokens.service";
import { DataSource } from "typeorm";
import { OrderMarket } from "../../orders/entities/order-market.entity";
import { UpdateOrderDto } from "../../orders/dto/update-order.dto";
import { NatsService } from "../../core/nats/nats.service";
import {
    OrderSide,
    OrderType,
    OrderStatus,
} from "../../orders/constants/order.constants";
import { CreateLendLimitOrderDto } from "../../orders/dto/create-lend-limit-order.dto";
import { CreateLendMarketOrderDto } from "../../orders/dto/create-lend-market-order.dto";
import { CreateBorrowLimitOrderDto } from "../../orders/dto/create-borrow-limit-order.dto";
import { CreateBorrowMarketOrderDto } from "../../orders/dto/create-borrow-market-order.dto";
import { OrderRepository } from "../../orders/repositories/order.repository";
import { PortfolioService } from "../../portfolio/portfolio.service";

describe("OrdersService", () => {
    let service: OrdersService;
    let orderRepository: jest.Mocked<OrderRepository>;
    let tokensService: jest.Mocked<TokensService>;
    let natsService: jest.Mocked<NatsService>;
    let priceService: {
        getPrice: jest.MockedFunction<PriceService["getPrice"]>;
    };
    let portfolioService: jest.Mocked<PortfolioService>;
    let dataSource: jest.Mocked<DataSource>;

    const mockWalletAddress = "0x1234567890abcdef1234567890abcdef12345678";
    const mockPrivyUserId = "did:privy:mock-user-id";
    const mockAccountId = "uuid-account-001";
    const mockAssetId = "550e8400-e29b-41d4-a716-446655440003";
    const mockMarketId = "550e8400-e29b-41d4-a716-446655440000";
    const mockMaturityDate = new Date("2025-06-01T00:00:00.000Z");
    const mockMaturityUnix = Math.floor(mockMaturityDate.getTime() / 1000);

    const createMockOrder = (overrides: Partial<Order> = {}): Order => ({
        id: "550e8400-e29b-41d4-a716-446655440001",
        accountId: mockAccountId,
        assetId: mockAssetId,
        quantity: "1000",
        filledQuantity: "0",
        settlementFee: "0",
        filledSettlementFee: null,
        side: OrderSide.Lend,
        type: OrderType.Limit,
        status: OrderStatus.Open,
        rate: 500,
        autoRollover: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    });

    beforeEach(async () => {
        const mockOrderRepository: Partial<jest.Mocked<OrderRepository>> = {
            create: jest.fn(),
            save: jest.fn(),
            saveOrderWithMarkets: jest.fn(),
            getOrCreateAccount: jest.fn(),
            getOpenOrders: jest.fn(),
            getOrderById: jest.fn(),
            findAccountByWallet: jest.fn(),
            hasCounterpartyOrders: jest.fn().mockResolvedValue(true),
            getTotalOpenQuantity: jest.fn().mockResolvedValue(0n),
            getOpenBorrowOrders: jest.fn().mockResolvedValue([]),
        };

        const mockTokensService: jest.Mocked<TokensService> = {
            validateTokenByAssetId: jest.fn(),
            getTokenDecimalsByAssetId: jest.fn(),
            getTokenByAssetId: jest.fn().mockResolvedValue({
                tokenAddress: "0xabcdef1234567890abcdef1234567890abcdef12",
            } as any),
        } as any;

        const mockNatsService = {
            publish: jest.fn(),
        };

        const mockPriceService = {
            getPrice: jest.fn().mockResolvedValue(1),
        };

        const mockMarketRepository = {
            getMarketsByIds: jest
                .fn()
                .mockResolvedValue([
                    { id: mockMarketId, maturity: mockMaturityDate } as Market,
                ]),
        };

        const mockPortfolioService = {
            getHealthFactorForAccount: jest
                .fn()
                .mockResolvedValue({ healthFactor: 2 }),
            getAssetBalance: jest.fn().mockResolvedValue("1000000000"),
            checkAvailableBalanceForLend: jest
                .fn()
                .mockResolvedValue(undefined),
            checkAvailableBalanceForBorrowFees: jest
                .fn()
                .mockResolvedValue(undefined),
        };

        const mockManager = {
            getRepository: jest.fn().mockImplementation((entity) => {
                if (entity === OrderMarket) {
                    return {
                        save: jest.fn().mockResolvedValue({}),
                        delete: jest.fn().mockResolvedValue({}),
                    };
                }
                return {
                    findOne: jest.fn(),
                    save: jest.fn().mockImplementation((val) => Promise.resolve(val)),
                };
            }),
        };

        const mockDataSource = {
            transaction: jest.fn().mockImplementation((cb: any) => cb(mockManager)),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                OrdersService,
                {
                    provide: OrderRepository,
                    useValue: mockOrderRepository,
                },
                {
                    provide: MarketRepositories,
                    useValue: mockMarketRepository,
                },
                {
                    provide: PriceService,
                    useValue: mockPriceService,
                },
                {
                    provide: TokensService,
                    useValue: mockTokensService,
                },
                {
                    provide: NatsService,
                    useValue: mockNatsService,
                },
                {
                    provide: PortfolioService,
                    useValue: mockPortfolioService,
                },
                {
                    provide: DataSource,
                    useValue: mockDataSource,
                },
            ],
        }).compile();

        service = module.get<OrdersService>(OrdersService);
        orderRepository = module.get(
            OrderRepository,
        ) as jest.Mocked<OrderRepository>;
        tokensService = module.get(TokensService);
        natsService = module.get(NatsService);
        portfolioService = module.get(
            PortfolioService,
        ) as jest.Mocked<PortfolioService>;
        priceService = {
            getPrice: module.get(PriceService).getPrice as any,
        };
        dataSource = module.get(DataSource);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("createLendLimitOrder", () => {
        const lendLimitDto: CreateLendLimitOrderDto = {
            assetId: mockAssetId,
            amount: "1000",
            marketIds: ["550e8400-e29b-41d4-a716-446655440000"],
            rate: 500,
        };

        it("should create a lend limit order with correct fields", async () => {
            const expectedOrder = createMockOrder({
                side: OrderSide.Lend,
                type: OrderType.Limit,
                rate: 500,
            });

            tokensService.validateTokenByAssetId.mockResolvedValue({} as any);
            tokensService.getTokenDecimalsByAssetId.mockResolvedValue(6);
            orderRepository.getOrCreateAccount.mockResolvedValue({
                id: mockAccountId,
            } as any);
            orderRepository.create.mockReturnValue(expectedOrder);
            orderRepository.saveOrderWithMarkets.mockResolvedValue(
                expectedOrder,
            );
            natsService.publish.mockResolvedValue(undefined);

            const result = await service.createLendLimitOrder(
                lendLimitDto,
                mockWalletAddress,
                mockPrivyUserId,
            );

            expect(result.statusCode).toBe(HttpStatus.CREATED);
            expect(result.data.side).toBe(OrderSide.Lend);
            expect(result.data.type).toBe(OrderType.Limit);
            expect(result.data.rate).toBe(5); // 500 basis points = 5%
            expect(result.data.autoRollover).toBe(false);
            expect(result.data.markets).toEqual([
                { marketId: mockMarketId, maturity: mockMaturityUnix },
            ]);
            expect(orderRepository.saveOrderWithMarkets).toHaveBeenCalledWith(
                expectedOrder,
                lendLimitDto.marketIds,
            );
        });

        it("should compute and pass settlement fee based on price", async () => {
            const expectedOrder = createMockOrder({
                side: OrderSide.Lend,
                type: OrderType.Limit,
                rate: 500,
            });

            tokensService.validateTokenByAssetId.mockResolvedValue({} as any);
            tokensService.getTokenDecimalsByAssetId.mockResolvedValue(6);
            orderRepository.getOrCreateAccount.mockResolvedValue({
                id: mockAccountId,
            } as any);
            orderRepository.create.mockReturnValue(expectedOrder);
            orderRepository.saveOrderWithMarkets.mockResolvedValue(
                expectedOrder,
            );
            natsService.publish.mockResolvedValue(undefined);
            // 1000 * 0.01% = 0.1, capped to 0.05 since price = 1
            (priceService.getPrice as jest.Mock).mockResolvedValue(1);

            await service.createLendLimitOrder(
                lendLimitDto,
                mockWalletAddress,
                mockPrivyUserId,
            );

            expect(orderRepository.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    settlementFee: "50000", // 0.05 * 10^6
                }),
            );
        });

        it("should set filledQuantity to 0 on creation", async () => {
            const expectedOrder = createMockOrder({
                quantity: "1000",
                filledQuantity: "0",
            });

            tokensService.validateTokenByAssetId.mockResolvedValue({} as any);
            tokensService.getTokenDecimalsByAssetId.mockResolvedValue(6);
            orderRepository.getOrCreateAccount.mockResolvedValue({
                id: mockAccountId,
            } as any);
            orderRepository.create.mockReturnValue(expectedOrder);
            orderRepository.saveOrderWithMarkets.mockResolvedValue(
                expectedOrder,
            );
            natsService.publish.mockResolvedValue(undefined);

            const result = await service.createLendLimitOrder(
                lendLimitDto,
                mockWalletAddress,
                mockPrivyUserId,
            );

            expect(result.data.originalAmount).toBe("1000");
        });

        it("should set initial status to Open", async () => {
            const expectedOrder = createMockOrder({ status: OrderStatus.Open });

            tokensService.validateTokenByAssetId.mockResolvedValue({} as any);
            tokensService.getTokenDecimalsByAssetId.mockResolvedValue(6);
            orderRepository.getOrCreateAccount.mockResolvedValue({
                id: mockAccountId,
            } as any);
            orderRepository.create.mockReturnValue(expectedOrder);
            orderRepository.saveOrderWithMarkets.mockResolvedValue(
                expectedOrder,
            );
            natsService.publish.mockResolvedValue(undefined);

            const result = await service.createLendLimitOrder(
                lendLimitDto,
                mockWalletAddress,
                mockPrivyUserId,
            );

            expect(result.data.status).toBe(OrderStatus.Open);
        });

        it("should publish order to NATS", async () => {
            const expectedOrder = createMockOrder();

            tokensService.getTokenDecimalsByAssetId.mockResolvedValue(6);
            orderRepository.getOrCreateAccount.mockResolvedValue({
                id: mockAccountId,
            } as any);
            orderRepository.create.mockReturnValue(expectedOrder);
            orderRepository.saveOrderWithMarkets.mockResolvedValue(
                expectedOrder,
            );
            natsService.publish.mockResolvedValue(undefined);

            await service.createLendLimitOrder(
                lendLimitDto,
                mockWalletAddress,
                mockPrivyUserId,
            );

            expect(natsService.publish).toHaveBeenCalledWith(
                "orders.lend.limit",
                expect.objectContaining({
                    orderId: expectedOrder.id,
                    walletAddress: mockWalletAddress,
                    assetId: expectedOrder.assetId,
                    side: OrderSide.Lend,
                    type: OrderType.Limit,
                }),
            );
        });

        it("should create new account if wallet not found", async () => {
            const expectedOrder = createMockOrder();
            tokensService.validateTokenByAssetId.mockResolvedValue({} as any);
            tokensService.getTokenDecimalsByAssetId.mockResolvedValue(6);
            orderRepository.getOrCreateAccount.mockResolvedValue({
                id: "new-account-id",
            } as any);
            orderRepository.create.mockReturnValue(expectedOrder);
            orderRepository.saveOrderWithMarkets.mockResolvedValue(
                expectedOrder,
            );
            natsService.publish.mockResolvedValue(undefined);

            await service.createLendLimitOrder(
                lendLimitDto,
                mockWalletAddress,
                mockPrivyUserId,
            );

            expect(orderRepository.getOrCreateAccount).toHaveBeenCalledWith(
                mockWalletAddress,
                mockPrivyUserId,
            );
        });

        it("should throw BadRequestException if assetId is not supported", async () => {
            tokensService.validateTokenByAssetId.mockRejectedValue(
                new BadRequestException("Token not supported"),
            );
            orderRepository.getOrCreateAccount.mockResolvedValue({
                id: mockAccountId,
            } as any);

            await expect(
                service.createLendLimitOrder(
                    lendLimitDto,
                    mockWalletAddress,
                    mockPrivyUserId,
                ),
            ).rejects.toThrow(BadRequestException);
        });

        it("should throw BadRequestException when price is not available", async () => {
            tokensService.validateTokenByAssetId.mockResolvedValue({} as any);
            tokensService.getTokenDecimalsByAssetId.mockResolvedValue(6);
            orderRepository.getOrCreateAccount.mockResolvedValue({
                id: mockAccountId,
            } as any);
            (priceService.getPrice as jest.Mock).mockResolvedValue(null);

            await expect(
                service.createLendLimitOrder(
                    lendLimitDto,
                    mockWalletAddress,
                    mockPrivyUserId,
                ),
            ).rejects.toThrow(BadRequestException);
        });

        it("should throw BadRequestException if available balance is insufficient", async () => {
            tokensService.validateTokenByAssetId.mockResolvedValue({} as any);
            tokensService.getTokenDecimalsByAssetId.mockResolvedValue(6); // 1000 * 10^6 = 1000000000
            orderRepository.getOrCreateAccount.mockResolvedValue({
                id: mockAccountId,
            } as any);

            portfolioService.checkAvailableBalanceForLend.mockRejectedValueOnce(
                new BadRequestException(
                    "Insufficient portfolio balance for this order",
                ),
            );

            await expect(
                service.createLendLimitOrder(
                    lendLimitDto,
                    mockWalletAddress,
                    mockPrivyUserId,
                ),
            ).rejects.toThrow("Insufficient portfolio balance for this order");
            expect(orderRepository.saveOrderWithMarkets).not.toHaveBeenCalled();
        });
    });

    describe("createLendMarketOrder", () => {
        const lendMarketDto: CreateLendMarketOrderDto = {
            assetId: mockAssetId,
            amount: "1000",
            marketIds: ["550e8400-e29b-41d4-a716-446655440000"],
        };

        it("should create a lend market order with 0 rate", async () => {
            const expectedOrder = createMockOrder({
                side: OrderSide.Lend,
                type: OrderType.Market,
                rate: 0,
            });

            tokensService.validateTokenByAssetId.mockResolvedValue({} as any);
            tokensService.getTokenDecimalsByAssetId.mockResolvedValue(6);
            orderRepository.getOrCreateAccount.mockResolvedValue({
                id: mockAccountId,
            } as any);
            orderRepository.create.mockReturnValue(expectedOrder);
            orderRepository.saveOrderWithMarkets.mockResolvedValue(
                expectedOrder,
            );
            natsService.publish.mockResolvedValue(undefined);

            const result = await service.createLendMarketOrder(
                lendMarketDto,
                mockWalletAddress,
                mockPrivyUserId,
            );

            expect(result.statusCode).toBe(HttpStatus.CREATED);
            expect(result.data.side).toBe(OrderSide.Lend);
            expect(result.data.type).toBe(OrderType.Market);
            expect(result.data.rate).toBe(0);
            expect(result.data.autoRollover).toBe(false);
            expect(result.data.markets).toEqual([
                { marketId: mockMarketId, maturity: mockMaturityUnix },
            ]);
            expect(orderRepository.saveOrderWithMarkets).toHaveBeenCalledWith(
                expectedOrder,
                lendMarketDto.marketIds,
            );
        });

        it("should compute and pass settlement fee for lend market orders", async () => {
            const expectedOrder = createMockOrder({
                side: OrderSide.Lend,
                type: OrderType.Market,
                rate: 0,
            });

            tokensService.validateTokenByAssetId.mockResolvedValue({} as any);
            tokensService.getTokenDecimalsByAssetId.mockResolvedValue(6);
            orderRepository.getOrCreateAccount.mockResolvedValue({
                id: mockAccountId,
            } as any);
            orderRepository.create.mockReturnValue(expectedOrder);
            orderRepository.saveOrderWithMarkets.mockResolvedValue(
                expectedOrder,
            );
            natsService.publish.mockResolvedValue(undefined);
            (priceService.getPrice as jest.Mock).mockResolvedValue(1);

            await service.createLendMarketOrder(
                lendMarketDto,
                mockWalletAddress,
                mockPrivyUserId,
            );

            expect(orderRepository.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    settlementFee: "50000",
                }),
            );
        });

        it("should publish to lend market NATS subject", async () => {
            const expectedOrder = createMockOrder({
                side: OrderSide.Lend,
                type: OrderType.Market,
                rate: 0,
            });

            tokensService.validateTokenByAssetId.mockResolvedValue({} as any);
            tokensService.getTokenDecimalsByAssetId.mockResolvedValue(6);
            orderRepository.getOrCreateAccount.mockResolvedValue({
                id: mockAccountId,
            } as any);
            orderRepository.create.mockReturnValue(expectedOrder);
            orderRepository.saveOrderWithMarkets.mockResolvedValue(
                expectedOrder,
            );
            natsService.publish.mockResolvedValue(undefined);

            await service.createLendMarketOrder(
                lendMarketDto,
                mockWalletAddress,
                mockPrivyUserId,
            );

            expect(natsService.publish).toHaveBeenCalledWith(
                "orders.lend.market",
                expect.anything(),
            );
        });

        it("should throw BadRequestException if available balance is insufficient", async () => {
            tokensService.validateTokenByAssetId.mockResolvedValue({} as any);
            tokensService.getTokenDecimalsByAssetId.mockResolvedValue(6); // 1000 * 10^6 = 1000000000
            orderRepository.getOrCreateAccount.mockResolvedValue({
                id: mockAccountId,
            } as any);

            portfolioService.checkAvailableBalanceForLend.mockRejectedValueOnce(
                new BadRequestException(
                    "Insufficient portfolio balance for this order",
                ),
            );

            await expect(
                service.createLendMarketOrder(
                    lendMarketDto,
                    mockWalletAddress,
                    mockPrivyUserId,
                ),
            ).rejects.toThrow("Insufficient portfolio balance for this order");
            expect(orderRepository.saveOrderWithMarkets).not.toHaveBeenCalled();
        });
    });

    describe("createBorrowLimitOrder", () => {
        const borrowLimitDto: CreateBorrowLimitOrderDto = {
            assetId: mockAssetId,
            amount: "5000",
            marketIds: ["550e8400-e29b-41d4-a716-446655440000"],
            rate: 750,
        };

        it("should create a borrow limit order with correct fields", async () => {
            const expectedOrder = createMockOrder({
                side: OrderSide.Borrow,
                type: OrderType.Limit,
                rate: 750,
                quantity: "5000",
            });

            tokensService.validateTokenByAssetId.mockResolvedValue({} as any);
            tokensService.getTokenDecimalsByAssetId.mockResolvedValue(6);
            orderRepository.getOrCreateAccount.mockResolvedValue({
                id: mockAccountId,
            } as any);
            orderRepository.create.mockReturnValue(expectedOrder);
            orderRepository.saveOrderWithMarkets.mockResolvedValue(
                expectedOrder,
            );
            natsService.publish.mockResolvedValue(undefined);

            const result = await service.createBorrowLimitOrder(
                borrowLimitDto,
                mockWalletAddress,
                mockPrivyUserId,
            );

            expect(result.statusCode).toBe(HttpStatus.CREATED);
            expect(result.data.side).toBe(OrderSide.Borrow);
            expect(result.data.type).toBe(OrderType.Limit);
            expect(result.data.rate).toBe(7.5); // 750 basis points = 7.5%
            expect(result.data.autoRollover).toBe(false);
            expect(result.data.markets).toEqual([
                { marketId: mockMarketId, maturity: mockMaturityUnix },
            ]);
            expect(orderRepository.saveOrderWithMarkets).toHaveBeenCalledWith(
                expectedOrder,
                borrowLimitDto.marketIds,
            );
        });

        it("should compute and pass settlement fee for borrow limit orders", async () => {
            const expectedOrder = createMockOrder({
                side: OrderSide.Borrow,
                type: OrderType.Limit,
                rate: 750,
                quantity: "5000",
            });

            tokensService.validateTokenByAssetId.mockResolvedValue({} as any);
            tokensService.getTokenDecimalsByAssetId.mockResolvedValue(6);
            orderRepository.getOrCreateAccount.mockResolvedValue({
                id: mockAccountId,
            } as any);
            orderRepository.create.mockReturnValue(expectedOrder);
            orderRepository.saveOrderWithMarkets.mockResolvedValue(
                expectedOrder,
            );
            natsService.publish.mockResolvedValue(undefined);
            (priceService.getPrice as jest.Mock).mockResolvedValue(1);

            await service.createBorrowLimitOrder(
                borrowLimitDto,
                mockWalletAddress,
                mockPrivyUserId,
            );

            expect(orderRepository.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    settlementFee: "50000",
                }),
            );
        });

        it("should publish to borrow limit NATS subject", async () => {
            const expectedOrder = createMockOrder({
                side: OrderSide.Borrow,
                type: OrderType.Limit,
            });

            tokensService.validateTokenByAssetId.mockResolvedValue({} as any);
            tokensService.getTokenDecimalsByAssetId.mockResolvedValue(6);
            orderRepository.getOrCreateAccount.mockResolvedValue({
                id: mockAccountId,
            } as any);
            orderRepository.create.mockReturnValue(expectedOrder);
            orderRepository.saveOrderWithMarkets.mockResolvedValue(
                expectedOrder,
            );
            natsService.publish.mockResolvedValue(undefined);

            await service.createBorrowLimitOrder(
                borrowLimitDto,
                mockWalletAddress,
                mockPrivyUserId,
            );

            expect(natsService.publish).toHaveBeenCalledWith(
                "orders.borrow.limit",
                expect.anything(),
            );
        });

        it("should throw BadRequestException when borrow would reduce health factor below 1", async () => {
            tokensService.validateTokenByAssetId.mockResolvedValue({} as any);
            tokensService.getTokenDecimalsByAssetId.mockResolvedValue(6);
            orderRepository.getOrCreateAccount.mockResolvedValue({
                id: mockAccountId,
            } as any);
            portfolioService.getHealthFactorForAccount.mockResolvedValueOnce({
                healthFactor: 0.8,
                collateralUsd: 1000,
                debtUsd: 500,
                weightedLtvDecimal: 0.75,
            });

            await expect(
                service.createBorrowLimitOrder(
                    borrowLimitDto,
                    mockWalletAddress,
                    mockPrivyUserId,
                ),
            ).rejects.toThrow(
                "Borrow would reduce health factor below 1 (considering open orders); position not allowed.",
            );
            expect(orderRepository.saveOrderWithMarkets).not.toHaveBeenCalled();
        });
    });

    describe("createBorrowMarketOrder", () => {
        const borrowMarketDto: CreateBorrowMarketOrderDto = {
            assetId: mockAssetId,
            amount: "5000",
            marketIds: ["550e8400-e29b-41d4-a716-446655440000"],
        };

        it("should create a borrow market order with 0 rate", async () => {
            const expectedOrder = createMockOrder({
                side: OrderSide.Borrow,
                type: OrderType.Market,
                rate: 0,
            });

            tokensService.validateTokenByAssetId.mockResolvedValue({} as any);
            tokensService.getTokenDecimalsByAssetId.mockResolvedValue(6);
            orderRepository.getOrCreateAccount.mockResolvedValue({
                id: mockAccountId,
            } as any);
            orderRepository.create.mockReturnValue(expectedOrder);
            orderRepository.saveOrderWithMarkets.mockResolvedValue(
                expectedOrder,
            );
            natsService.publish.mockResolvedValue(undefined);

            const result = await service.createBorrowMarketOrder(
                borrowMarketDto,
                mockWalletAddress,
                mockPrivyUserId,
            );

            expect(result.statusCode).toBe(HttpStatus.CREATED);
            expect(result.data.side).toBe(OrderSide.Borrow);
            expect(result.data.type).toBe(OrderType.Market);
            expect(result.data.rate).toBe(0);
            expect(result.data.autoRollover).toBe(false);
            expect(result.data.markets).toEqual([
                { marketId: mockMarketId, maturity: mockMaturityUnix },
            ]);
            expect(orderRepository.saveOrderWithMarkets).toHaveBeenCalledWith(
                expectedOrder,
                borrowMarketDto.marketIds,
            );
        });

        it("should compute and pass settlement fee for borrow market orders", async () => {
            const expectedOrder = createMockOrder({
                side: OrderSide.Borrow,
                type: OrderType.Market,
                rate: 0,
                quantity: "5000",
            });

            tokensService.validateTokenByAssetId.mockResolvedValue({} as any);
            tokensService.getTokenDecimalsByAssetId.mockResolvedValue(6);
            orderRepository.getOrCreateAccount.mockResolvedValue({
                id: mockAccountId,
            } as any);
            orderRepository.create.mockReturnValue(expectedOrder);
            orderRepository.saveOrderWithMarkets.mockResolvedValue(
                expectedOrder,
            );
            natsService.publish.mockResolvedValue(undefined);
            (priceService.getPrice as jest.Mock).mockResolvedValue(1);

            await service.createBorrowMarketOrder(
                borrowMarketDto,
                mockWalletAddress,
                mockPrivyUserId,
            );

            expect(orderRepository.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    settlementFee: "50000",
                }),
            );
        });

        it("should publish to borrow market NATS subject", async () => {
            const expectedOrder = createMockOrder({
                side: OrderSide.Borrow,
                type: OrderType.Market,
                rate: 0,
            });

            tokensService.validateTokenByAssetId.mockResolvedValue({} as any);
            tokensService.getTokenDecimalsByAssetId.mockResolvedValue(6);
            orderRepository.getOrCreateAccount.mockResolvedValue({
                id: mockAccountId,
            } as any);
            orderRepository.create.mockReturnValue(expectedOrder);
            orderRepository.saveOrderWithMarkets.mockResolvedValue(
                expectedOrder,
            );
            natsService.publish.mockResolvedValue(undefined);

            await service.createBorrowMarketOrder(
                borrowMarketDto,
                mockWalletAddress,
                mockPrivyUserId,
            );

            expect(natsService.publish).toHaveBeenCalledWith(
                "orders.borrow.market",
                expect.anything(),
            );
        });

        it("should throw BadRequestException when borrow would reduce health factor below 1", async () => {
            tokensService.validateTokenByAssetId.mockResolvedValue({} as any);
            tokensService.getTokenDecimalsByAssetId.mockResolvedValue(6);
            orderRepository.getOrCreateAccount.mockResolvedValue({
                id: mockAccountId,
            } as any);
            portfolioService.getHealthFactorForAccount.mockResolvedValueOnce({
                healthFactor: 0.5,
                collateralUsd: 500,
                debtUsd: 1000,
                weightedLtvDecimal: 0.75,
            });

            await expect(
                service.createBorrowMarketOrder(
                    borrowMarketDto,
                    mockWalletAddress,
                    mockPrivyUserId,
                ),
            ).rejects.toThrow(
                "Borrow would reduce health factor below 1 (considering open orders); position not allowed.",
            );
            expect(orderRepository.saveOrderWithMarkets).not.toHaveBeenCalled();
        });
    });

    describe("cancelOrder", () => {
        it("should cancel an open order successfully", async () => {
            const openOrder = createMockOrder({
                id: "uuid-cancel-001",
                status: OrderStatus.Open,
            });

            const cancelledOrder = {
                ...openOrder,
                status: OrderStatus.Cancelled,
            };

            orderRepository.getOrderById.mockResolvedValue(openOrder);
            orderRepository.findAccountByWallet.mockResolvedValue({
                id: mockAccountId,
            } as any);
            orderRepository.save.mockResolvedValue(cancelledOrder);
            natsService.publish.mockResolvedValue(undefined);

            const result = await service.cancelOrder(
                "uuid-cancel-001",
                mockWalletAddress,
            );

            expect(result.status).toBe(OrderStatus.Cancelled);
        });

        it("should cancel a partial order successfully", async () => {
            const partialOrder = createMockOrder({
                id: "uuid-cancel-002",
                status: OrderStatus.PartiallyFilled,
                quantity: "1000",
                filledQuantity: "500",
            });

            const cancelledOrder = {
                ...partialOrder,
                status: OrderStatus.Cancelled,
            };

            orderRepository.getOrderById.mockResolvedValue(partialOrder);
            orderRepository.findAccountByWallet.mockResolvedValue({
                id: mockAccountId,
            } as any);
            orderRepository.save.mockResolvedValue(cancelledOrder);
            natsService.publish.mockResolvedValue(undefined);

            const result = await service.cancelOrder(
                "uuid-cancel-002",
                mockWalletAddress,
            );

            expect(result.status).toBe(OrderStatus.Cancelled);
        });

        it("should throw NotFoundException for non-existent order", async () => {
            orderRepository.getOrderById.mockResolvedValue(null);

            await expect(
                service.cancelOrder("non-existent-uuid", mockWalletAddress),
            ).rejects.toThrow(NotFoundException);
        });

        it("should throw ForbiddenException when cancelling order owned by another wallet", async () => {
            const otherWalletOrder = createMockOrder({
                id: "uuid-cancel-003",
                accountId: "other-account-uuid",
                status: OrderStatus.Open,
            });

            orderRepository.getOrderById.mockResolvedValue(otherWalletOrder);
            orderRepository.findAccountByWallet.mockResolvedValue({
                id: mockAccountId,
            } as any);

            await expect(
                service.cancelOrder("uuid-cancel-003", mockWalletAddress),
            ).rejects.toThrow(ForbiddenException);
        });

        it("should throw BadRequestException when cancelling a filled order", async () => {
            const filledOrder = createMockOrder({
                id: "uuid-cancel-004",
                status: OrderStatus.Filled,
            });

            orderRepository.getOrderById.mockResolvedValue(filledOrder);
            orderRepository.findAccountByWallet.mockResolvedValue({
                id: mockAccountId,
            } as any);

            await expect(
                service.cancelOrder("uuid-cancel-004", mockWalletAddress),
            ).rejects.toThrow(BadRequestException);
        });

        it("should throw BadRequestException when cancelling an already cancelled order", async () => {
            const cancelledOrder = createMockOrder({
                id: "uuid-cancel-005",
                status: OrderStatus.Cancelled,
            });

            orderRepository.getOrderById.mockResolvedValue(cancelledOrder);
            orderRepository.findAccountByWallet.mockResolvedValue({
                id: mockAccountId,
            } as any);

            await expect(
                service.cancelOrder("uuid-cancel-005", mockWalletAddress),
            ).rejects.toThrow(BadRequestException);
        });

        it("should publish cancel event to NATS", async () => {
            const openOrder = createMockOrder({
                id: "uuid-cancel-007",
                status: OrderStatus.Open,
            });

            orderRepository.getOrderById.mockResolvedValue(openOrder);
            orderRepository.findAccountByWallet.mockResolvedValue({
                id: mockAccountId,
            } as any);
            orderRepository.save.mockResolvedValue({
                ...openOrder,
                status: OrderStatus.Cancelled,
            });
            natsService.publish.mockResolvedValue(undefined);

            await service.cancelOrder("uuid-cancel-007", mockWalletAddress);

            expect(natsService.publish).toHaveBeenCalledWith(
                "orders.cancel",
                expect.objectContaining({
                    orderId: "uuid-cancel-007",
                    walletAddress: mockWalletAddress,
                }),
            );
        });
    });

    describe("updateOrder", () => {
        const updateDto: UpdateOrderDto = {
            amount: "1500",
            marketIds: [mockMarketId],
            rate: 600,
        };

        it("should successfully update an order", async () => {
            const existingOrder = createMockOrder({
                status: OrderStatus.Open,
            });

            orderRepository.findAccountByWallet.mockResolvedValue({
                id: mockAccountId,
            } as any);
            tokensService.getTokenDecimalsByAssetId.mockResolvedValue(6);
            
            // Mock transaction manager repository results
            const mockRepo = {
                findOne: jest.fn().mockResolvedValue(existingOrder),
                save: jest.fn().mockImplementation((v) => Promise.resolve(v)),
                delete: jest.fn().mockResolvedValue({}),
            };
            (dataSource.transaction as jest.Mock).mockImplementationOnce(async (cb) => {
                return cb({
                    getRepository: jest.fn().mockReturnValue(mockRepo),
                });
            });

            const result = await service.updateOrder(
                existingOrder.id,
                mockWalletAddress,
                updateDto,
            );

            expect(result.quantity).toBe("1500000000"); // 1500 * 10^6
            expect(result.rate).toBe(600);
            expect(result.status).toBe(OrderStatus.Open);
            expect(result.settlementFee).toBe("50000"); // 1500 * 0.01% = 0.15, capped to 0.05
            expect(natsService.publish).toHaveBeenCalled();
        });

        it("should maintain PartiallyFilled status if order was already partially filled", async () => {
            const existingOrder = createMockOrder({
                status: OrderStatus.PartiallyFilled,
                filledQuantity: "500000000", // 500
            });

            orderRepository.findAccountByWallet.mockResolvedValue({ id: mockAccountId } as any);
            tokensService.getTokenDecimalsByAssetId.mockResolvedValue(6);
            
            const mockRepo = {
                findOne: jest.fn().mockResolvedValue(existingOrder),
                save: jest.fn().mockImplementation((v) => Promise.resolve(v)),
                delete: jest.fn().mockResolvedValue({}),
            };
            (dataSource.transaction as jest.Mock).mockImplementationOnce(async (cb) => {
                return cb({ getRepository: jest.fn().mockReturnValue(mockRepo) });
            });

            const result = await service.updateOrder(existingOrder.id, mockWalletAddress, updateDto);

            expect(result.status).toBe(OrderStatus.PartiallyFilled);
            expect(BigInt(result.quantity)).toBe(1500000000n);
        });

        it("should throw BadRequestException if new quantity is less than or equal to filled quantity", async () => {
            const existingOrder = createMockOrder({
                status: OrderStatus.PartiallyFilled,
                filledQuantity: "2000000000", // 2000
            });

            orderRepository.findAccountByWallet.mockResolvedValue({ id: mockAccountId } as any);
            tokensService.getTokenDecimalsByAssetId.mockResolvedValue(6);
            
            const mockRepo = {
                findOne: jest.fn().mockResolvedValue(existingOrder),
            };
            (dataSource.transaction as jest.Mock).mockImplementationOnce(async (cb) => {
                return cb({ getRepository: jest.fn().mockReturnValue(mockRepo) });
            });

            await expect(
                service.updateOrder(existingOrder.id, mockWalletAddress, updateDto),
            ).rejects.toThrow("New quantity must be greater than the already filled quantity");
        });

        it("should throw ForbiddenException if user does not own the order", async () => {
            const otherOrder = createMockOrder({
                accountId: "other-account",
            });

            orderRepository.findAccountByWallet.mockResolvedValue({
                id: mockAccountId,
            } as any);

            const mockRepo = {
                findOne: jest.fn().mockResolvedValue(otherOrder),
            };
            (dataSource.transaction as jest.Mock).mockImplementationOnce(async (cb) => {
                return cb({
                    getRepository: jest.fn().mockReturnValue(mockRepo),
                });
            });

            await expect(
                service.updateOrder(otherOrder.id, mockWalletAddress, updateDto),
            ).rejects.toThrow(ForbiddenException);
        });

        it("should throw BadRequestException if order status is not open/partial", async () => {
            const cancelledOrder = createMockOrder({
                status: OrderStatus.Cancelled,
            });

            orderRepository.findAccountByWallet.mockResolvedValue({
                id: mockAccountId,
            } as any);

            const mockRepo = {
                findOne: jest.fn().mockResolvedValue(cancelledOrder),
            };
            (dataSource.transaction as jest.Mock).mockImplementationOnce(async (cb) => {
                return cb({
                    getRepository: jest.fn().mockReturnValue(mockRepo),
                });
            });

            await expect(
                service.updateOrder(cancelledOrder.id, mockWalletAddress, updateDto),
            ).rejects.toThrow(BadRequestException);
        });
    });
});
