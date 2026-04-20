import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Repository, In } from "typeorm";
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
import { PortfolioRepository } from "../../portfolio/repositories/portfolio.repository";
import { TokensService } from "../../tokens/tokens.service";
import { PriceService } from "../../price/price.service";
import { OrderStatus } from "../../orders/constants/order.constants";
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

describe("OrdersWorker Spread Cancellation", () => {
    let worker: OrdersWorker;
    let orderRepository: jest.Mocked<OrderRepository>;
    let ordersService: jest.Mocked<OrdersService>;
    let marketRepository: jest.Mocked<Repository<Market>>;
    let tokenRepository: jest.Mocked<Repository<Token>>;

    const MOCK_BOT_WALLET = "0xBotWallet";
    const MOCK_ACCOUNT_ID = "b0000000-0000-0000-0000-000000000001";
    const MOCK_ASSET_ID = MOCK_IDS.assetId;

    beforeEach(async () => {
        process.env.NODE_ENV = "development";
        process.env.ORDER_WORKER_ENABLED = "true";

        const mockOrderRepo = createMockOrderRepository();
        const mockMarketRepo = createMockRepository<Market>();
        const mockTokenRepo = createMockRepository<Token>();
        const mockOrdersService = createMockOrdersService();

        // Specific mocks for spread testing
        mockOrderRepo.getBestRatesForAsset = jest.fn();
        mockOrderRepo.findAccountByWallet = jest.fn();
        mockOrderRepo.find = jest.fn();
        mockOrdersService.cancelOrder = jest.fn().mockResolvedValue({});

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
                        get: jest.fn((key) => {
                            if (key === "OPERATOR_PRIVATE_KEY") return "0x123";
                            return undefined;
                        }),
                    },
                },
                {
                    provide: ChainConfigService,
                    useValue: {
                        chainId: 421614,
                        operatorPrivateKey: "0x123",
                        treasuryAddress: "0xTreasury",
                    },
                },
                {
                    provide: PortfolioService,
                    useValue: {
                        getAssetBalance: jest.fn().mockResolvedValue("1000000"),
                        getHealthFactorForAccount: jest.fn().mockResolvedValue({
                            healthFactor: Infinity,
                        }),
                        setAssetAsCollateral: jest.fn(),
                    },
                },
                {
                    provide: PortfolioRepository,
                    useValue: {
                        upsertPortfolio: jest.fn(),
                        syncPortfolioBalance: jest.fn(),
                    },
                },
                {
                    provide: TokensService,
                    useValue: {
                        getTokenDecimalsByAssetId: jest.fn().mockResolvedValue(6),
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
        orderRepository = module.get(OrderRepository) as jest.Mocked<OrderRepository>;
        ordersService = module.get(OrdersService) as jest.Mocked<OrdersService>;
        marketRepository = module.get(getRepositoryToken(Market)) as jest.Mocked<Repository<Market>>;
        tokenRepository = module.get(getRepositoryToken(Token)) as jest.Mocked<Repository<Token>>;

        // Setup bot accounts
        (worker as any).botAccounts = [
            {
                privateKey: "0x123",
                wallet: MOCK_BOT_WALLET,
                privyUserId: "did:privy:bot",
            },
        ];
        (worker as any).initialized = true;

        // Setup cache
        const market = createMockMarket({ id: "m1", assetId: MOCK_ASSET_ID });
        const token = createMockToken({ id: MOCK_ASSET_ID, symbol: "USDC" });
        marketRepository.find.mockResolvedValue([market]);
        tokenRepository.find.mockResolvedValue([token]);
        await worker.refreshAssetMarketCache();
    });

describe("OrdersWorker Spread Cancellation", () => {
    let worker: OrdersWorker;
    let orderRepository: jest.Mocked<OrderRepository>;
    let ordersService: jest.Mocked<OrdersService>;
    let marketRepository: jest.Mocked<Repository<Market>>;
    let tokenRepository: jest.Mocked<Repository<Token>>;

    const MOCK_BOT_WALLET = "0xBotWallet";
    const MOCK_ACCOUNT_ID = "b0000000-0000-0000-0000-000000000001";
    const MOCK_ASSET_ID = MOCK_IDS.assetId;
    const MOCK_MARKET_ID = "m1";

    beforeEach(async () => {
        process.env.NODE_ENV = "development";
        process.env.ORDER_WORKER_ENABLED = "true";

        const mockOrderRepo = createMockOrderRepository();
        const mockMarketRepo = createMockRepository<Market>();
        const mockTokenRepo = createMockRepository<Token>();
        const mockOrdersService = createMockOrdersService();

        // Specific mocks for spread testing
        mockOrderRepo.findActiveLimitOrdersForOrderbook = jest.fn();
        mockOrderRepo.findAccountByWallet = jest.fn();
        mockOrdersService.cancelOrder = jest.fn().mockResolvedValue({});

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
                        get: jest.fn((key) => {
                            if (key === "OPERATOR_PRIVATE_KEY") return "0x123";
                            return undefined;
                        }),
                    },
                },
                {
                    provide: ChainConfigService,
                    useValue: {
                        chainId: 421614,
                        operatorPrivateKey: "0x123",
                        treasuryAddress: "0xTreasury",
                    },
                },
                {
                    provide: PortfolioService,
                    useValue: {
                        getAssetBalance: jest.fn().mockResolvedValue("1000000"),
                        getHealthFactorForAccount: jest.fn().mockResolvedValue({
                            healthFactor: Infinity,
                        }),
                        setAssetAsCollateral: jest.fn(),
                    },
                },
                {
                    provide: PortfolioRepository,
                    useValue: {
                        upsertPortfolio: jest.fn(),
                        syncPortfolioBalance: jest.fn(),
                    },
                },
                {
                    provide: TokensService,
                    useValue: {
                        getTokenDecimalsByAssetId: jest.fn().mockResolvedValue(6),
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
        orderRepository = module.get(OrderRepository) as jest.Mocked<OrderRepository>;
        ordersService = module.get(OrdersService) as jest.Mocked<OrdersService>;
        marketRepository = module.get(getRepositoryToken(Market)) as jest.Mocked<Repository<Market>>;
        tokenRepository = module.get(getRepositoryToken(Token)) as jest.Mocked<Repository<Token>>;

        // Setup bot accounts
        (worker as any).botAccounts = [
            {
                privateKey: "0x123",
                wallet: MOCK_BOT_WALLET,
                privyUserId: "did:privy:bot",
            },
        ];
        (worker as any).initialized = true;

        // Setup cache
        const market = createMockMarket({ id: MOCK_MARKET_ID, assetId: MOCK_ASSET_ID });
        const token = createMockToken({ id: MOCK_ASSET_ID, symbol: "USDC" });
        marketRepository.find.mockResolvedValue([market]);
        tokenRepository.find.mockResolvedValue([token]);
        await worker.refreshAssetMarketCache();
    });

    describe("Market-Aware Spread Cancellation", () => {
        it("should NO-OP if spread is exactly 1%", async () => {
            // bestAsk = 505, bestBid = 500 => spread = (505-500)/500 = 0.01
            orderRepository.findActiveLimitOrdersForOrderbook.mockResolvedValue([
                { rate: 505, side: "LEND", markets: [{ marketId: MOCK_MARKET_ID }] } as any,
                { rate: 500, side: "BORROW", markets: [{ marketId: MOCK_MARKET_ID }] } as any,
            ]);

            await worker.placeOrders();

            expect(ordersService.cancelOrder).not.toHaveBeenCalled();
        });

        it("should CANCEL orders if spread is > 1%", async () => {
            // bestAsk = 506, bestBid = 500 => spread = (506-500)/500 = 0.012 (1.2%)
            orderRepository.findActiveLimitOrdersForOrderbook.mockResolvedValue([
                { id: "o1", rate: 506, side: "LEND", markets: [{ marketId: MOCK_MARKET_ID }], accountId: MOCK_ACCOUNT_ID } as any,
                { id: "o2", rate: 500, side: "BORROW", markets: [{ marketId: MOCK_MARKET_ID }], accountId: "other" } as any,
            ]);

            orderRepository.findAccountByWallet.mockResolvedValue({
                id: MOCK_ACCOUNT_ID,
                userWallet: MOCK_BOT_WALLET,
            } as any);

            await worker.placeOrders();

            expect(ordersService.cancelOrder).toHaveBeenCalledWith("o1", MOCK_BOT_WALLET);
        });

        it("should handle multiple markets independently", async () => {
            const market2 = "m2";
            (worker as any).assetMarketCache[0].marketIds.push(market2);

            orderRepository.findActiveLimitOrdersForOrderbook.mockResolvedValue([
                // Market 1: wide spread (550 vs 500 = 10%)
                { id: "o_m1", rate: 550, side: "LEND", markets: [{ marketId: MOCK_MARKET_ID }], accountId: MOCK_ACCOUNT_ID } as any,
                { id: "o_m1_b", rate: 500, side: "BORROW", markets: [{ marketId: MOCK_MARKET_ID }], accountId: "other" } as any,
                // Market 2: tight spread (501 vs 500 < 1%)
                { id: "o_m2", rate: 501, side: "LEND", markets: [{ marketId: market2 }], accountId: MOCK_ACCOUNT_ID } as any,
                { id: "o_m2_b", rate: 500, side: "BORROW", markets: [{ marketId: market2 }], accountId: "other" } as any,
            ]);

            orderRepository.findAccountByWallet.mockResolvedValue({
                id: MOCK_ACCOUNT_ID,
                userWallet: MOCK_BOT_WALLET,
            } as any);

            await worker.placeOrders();

            // Should cancel o_m1 but NOT o_m2
            expect(ordersService.cancelOrder).toHaveBeenCalledWith("o_m1", MOCK_BOT_WALLET);
            expect(ordersService.cancelOrder).not.toHaveBeenCalledWith("o_m2", MOCK_BOT_WALLET);
        });

        it("should SKIP cancellation if bestBid is zero", async () => {
            orderRepository.findActiveLimitOrdersForOrderbook.mockResolvedValue([
                { rate: 510, side: "LEND", markets: [{ marketId: MOCK_MARKET_ID }] } as any,
                { rate: 0, side: "BORROW", markets: [{ marketId: MOCK_MARKET_ID }] } as any,
            ]);

            await worker.placeOrders();

            expect(ordersService.cancelOrder).not.toHaveBeenCalled();
        });

        it("should handle no orders in market", async () => {
            orderRepository.findActiveLimitOrdersForOrderbook.mockResolvedValue([]);

            await worker.placeOrders();

            expect(ordersService.cancelOrder).not.toHaveBeenCalled();
        });
    });
});
});
