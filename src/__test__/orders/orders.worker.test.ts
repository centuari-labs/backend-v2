import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ConfigService } from "@nestjs/config";
import { OrdersWorker } from "../../orders/orders.worker";
import { OrderRepository } from "../../orders/repositories/order.repository";
import { OrdersService } from "../../orders/orders.service";
import { Market } from "../../market/entities/market.entity";
import { Token } from "../../tokens/entities/token.entity";
import { ViemService } from "../../core/viem/viem.service";
import { ChainConfigService } from "../../core/chain-config/chain-config.service";
import { FaucetService } from "../../faucet/faucet.service";
import { PortfolioService } from "../../portfolio/portfolio.service";
import { TokensService } from "../../tokens/tokens.service";
import { PriceService } from "../../price/price.service";
import {
    createMockMarket,
    createMockToken,
    MOCK_IDS,
} from "../helpers/mock-factories";
import {
    createMockOrderRepository,
    createMockOrdersService,
    createMockRepository,
} from "../helpers/mock-services";

describe("OrdersWorker", () => {
    let worker: OrdersWorker;
    let orderRepository: jest.Mocked<OrderRepository>;
    let marketRepository: jest.Mocked<Repository<Market>>;
    let tokenRepository: jest.Mocked<Repository<Token>>;
    let ordersService: jest.Mocked<OrdersService>;

    const originalEnv = process.env;

    beforeEach(async () => {
        process.env = {
            ...originalEnv,
            NODE_ENV: "development",
            ORDER_WORKER_ENABLED: "true",
        };

        const mockOrderRepo = createMockOrderRepository();
        const mockMarketRepo = createMockRepository<Market>();
        const mockTokenRepo = createMockRepository<Token>();
        const mockOrdersService = createMockOrdersService();

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                OrdersWorker,
                { provide: OrderRepository, useValue: mockOrderRepo },
                {
                    provide: getRepositoryToken(Market),
                    useValue: mockMarketRepo,
                },
                { provide: getRepositoryToken(Token), useValue: mockTokenRepo },
                { provide: OrdersService, useValue: mockOrdersService },
                {
                    provide: ViemService,
                    useValue: {
                        readContract: jest.fn(),
                        writeContract: jest.fn(),
                        getPublicClient: jest.fn(),
                        getWalletClient: jest.fn(),
                        resetWalletClient: jest.fn(),
                    },
                },
                {
                    provide: FaucetService,
                    useValue: {
                        requestTokensBatch: jest.fn().mockResolvedValue({}),
                    },
                },
                {
                    provide: ConfigService,
                    useValue: {
                        get: jest.fn().mockReturnValue(undefined),
                    },
                },
                {
                    provide: ChainConfigService,
                    useValue: {
                        chainId: 421614,
                        operatorPrivateKey: "0xtest",
                        hubDepositorAddress: "0xHubDepositor",
                        centuariAddress: "",
                    },
                },
                {
                    provide: PortfolioService,
                    useValue: {
                        getAssetBalance: jest.fn().mockResolvedValue("0"),
                        getHealthFactorForAccount: jest.fn().mockResolvedValue({
                            healthFactor: Infinity,
                        }),
                        setAssetAsCollateral: jest
                            .fn()
                            .mockResolvedValue(undefined),
                        checkAvailableBalanceForLend: jest
                            .fn()
                            .mockResolvedValue(undefined),
                        checkAvailableBalanceForBorrowFees: jest
                            .fn()
                            .mockResolvedValue(undefined),
                    },
                },
                {
                    provide: TokensService,
                    useValue: {
                        getTokenDecimalsByAssetId: jest
                            .fn()
                            .mockResolvedValue(6),
                    },
                },
                {
                    provide: PriceService,
                    useValue: {
                        getPrice: jest.fn().mockResolvedValue(1),
                    },
                },
            ],
        }).compile();

        worker = module.get<OrdersWorker>(OrdersWorker);
        orderRepository = module.get(
            OrderRepository,
        ) as jest.Mocked<OrderRepository>;
        marketRepository = module.get(
            getRepositoryToken(Market),
        ) as jest.Mocked<Repository<Market>>;
        tokenRepository = module.get(getRepositoryToken(Token)) as jest.Mocked<
            Repository<Token>
        >;
        ordersService = module.get(OrdersService) as jest.Mocked<OrdersService>;
    });

    afterEach(() => {
        process.env = originalEnv;
        jest.clearAllMocks();
    });

    describe("onModuleInit", () => {
        it("should skip when disabled (production)", async () => {
            process.env.NODE_ENV = "production";

            await worker.onModuleInit();

            expect(marketRepository.find).not.toHaveBeenCalled();
        });

        it("should skip when ORDER_WORKER_ENABLED is not true", async () => {
            process.env.ORDER_WORKER_ENABLED = "false";

            await worker.onModuleInit();

            expect(marketRepository.find).not.toHaveBeenCalled();
        });
    });

    describe("refreshAssetMarketCache", () => {
        it("should populate cache from markets and tokens", async () => {
            const market1 = createMockMarket({
                id: "c0000000-0000-0000-0000-000000000001",
                assetId: MOCK_IDS.assetId,
            });
            const market2 = createMockMarket({
                id: "c0000000-0000-0000-0000-000000000002",
                assetId: MOCK_IDS.assetId,
            });
            const token = createMockToken({ id: MOCK_IDS.assetId });

            marketRepository.find.mockResolvedValue([market1, market2]);
            tokenRepository.find.mockResolvedValue([token]);

            await worker.refreshAssetMarketCache();

            expect(marketRepository.find).toHaveBeenCalled();
            expect(tokenRepository.find).toHaveBeenCalled();
        });

        it("should handle empty markets gracefully", async () => {
            marketRepository.find.mockResolvedValue([]);
            tokenRepository.find.mockResolvedValue([]);

            await worker.refreshAssetMarketCache();

            expect(marketRepository.find).toHaveBeenCalled();
        });

        it("should log error on failure", async () => {
            marketRepository.find.mockRejectedValue(
                new Error("DB connection failed"),
            );

            await expect(
                worker.refreshAssetMarketCache(),
            ).resolves.not.toThrow();
        });

        it("should skip when disabled", async () => {
            process.env.NODE_ENV = "production";

            await worker.refreshAssetMarketCache();

            expect(marketRepository.find).not.toHaveBeenCalled();
        });
    });

    describe("placeOrders", () => {
        beforeEach(async () => {
            const market = createMockMarket();
            const token = createMockToken();
            marketRepository.find.mockResolvedValue([market]);
            tokenRepository.find.mockResolvedValue([token]);
            await worker.refreshAssetMarketCache();
            jest.clearAllMocks();
        });

        it("should skip when cache is empty", async () => {
            marketRepository.find.mockResolvedValue([]);
            tokenRepository.find.mockResolvedValue([]);
            await worker.refreshAssetMarketCache();

            await worker.placeOrders();

            expect(ordersService.createLendLimitOrder).not.toHaveBeenCalled();
            expect(ordersService.createBorrowLimitOrder).not.toHaveBeenCalled();
        });

        it("should handle creation error gracefully", async () => {
            ordersService.createLendLimitOrder.mockRejectedValue(
                new Error("Creation failed"),
            );
            ordersService.createBorrowLimitOrder.mockRejectedValue(
                new Error("Creation failed"),
            );

            await expect(worker.placeOrders()).resolves.not.toThrow();
        });

        it("should skip when disabled", async () => {
            process.env.NODE_ENV = "production";

            await worker.placeOrders();

            expect(ordersService.createLendLimitOrder).not.toHaveBeenCalled();
            expect(ordersService.createBorrowLimitOrder).not.toHaveBeenCalled();
        });
    });
});
