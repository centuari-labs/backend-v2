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

    describe("Spread Audit Logic", () => {
        it("should NO-OP if spread is exactly 1%", async () => {
            // bestAsk = 505, bestBid = 500 => spread = (505-500)/500 = 0.01
            orderRepository.getBestRatesForAsset.mockResolvedValue({
                bestLendRate: 505,
                bestBorrowRate: 500,
            });

            await worker.placeOrders();

            expect(ordersService.cancelOrder).not.toHaveBeenCalled();
        });

        it("should CANCEL orders if spread is > 1%", async () => {
            // bestAsk = 506, bestBid = 500 => spread = (506-500)/500 = 0.012 (1.2%)
            orderRepository.getBestRatesForAsset.mockResolvedValue({
                bestLendRate: 506,
                bestBorrowRate: 500,
            });

            orderRepository.findAccountByWallet.mockResolvedValue({
                id: MOCK_ACCOUNT_ID,
                userWallet: MOCK_BOT_WALLET,
            } as any);

            orderRepository.find.mockResolvedValue([
                { id: "order1", assetId: MOCK_ASSET_ID, status: OrderStatus.Open } as any,
            ]);

            await worker.placeOrders();

            expect(orderRepository.find).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: {
                        accountId: MOCK_ACCOUNT_ID,
                        assetId: MOCK_ASSET_ID,
                        status: In([OrderStatus.Open, OrderStatus.PartiallyFilled]),
                    },
                }),
            );
            expect(ordersService.cancelOrder).toHaveBeenCalledWith("order1", MOCK_BOT_WALLET);
        });

        it("should SKIP cancellation if bestBid is zero", async () => {
            orderRepository.getBestRatesForAsset.mockResolvedValue({
                bestLendRate: 510,
                bestBorrowRate: 0,
            });

            await worker.placeOrders();

            expect(orderRepository.find).not.toHaveBeenCalled();
            expect(ordersService.cancelOrder).not.toHaveBeenCalled();
        });

        it("should SKIP cancellation if bestAsk is less than bestBid (crossed book)", async () => {
            orderRepository.getBestRatesForAsset.mockResolvedValue({
                bestLendRate: 400,
                bestBorrowRate: 500,
            });

            await worker.placeOrders();

            expect(orderRepository.find).not.toHaveBeenCalled();
            expect(ordersService.cancelOrder).not.toHaveBeenCalled();
        });

        it("should handle mixed bot presence correctly", async () => {
            // Asset A: wide spread
            // bot1 exists, bot2 doesn't have an account
            (worker as any).botAccounts = [
                { wallet: "0xBot1", privateKey: "0x1" },
                { wallet: "0xBot2", privateKey: "0x2" },
            ];

            orderRepository.getBestRatesForAsset.mockResolvedValue({
                bestLendRate: 600,
                bestBorrowRate: 500, // spread = 20%
            });

            orderRepository.findAccountByWallet.mockImplementation(async (wallet) => {
                if (wallet === "0xBot1") return { id: "acc1" } as any;
                return null;
            });

            orderRepository.find.mockImplementation(async (params: any) => {
                if (params.where.accountId === "acc1") {
                    return [{ id: "order_b1" }] as any;
                }
                return [];
            });

            await worker.placeOrders();

            expect(ordersService.cancelOrder).toHaveBeenCalledTimes(1);
            expect(ordersService.cancelOrder).toHaveBeenCalledWith("order_b1", "0xBot1");
        });

        it("should handle best rates being null", async () => {
            orderRepository.getBestRatesForAsset.mockResolvedValue({
                bestLendRate: null,
                bestBorrowRate: 500,
            });

            await worker.placeOrders();

            expect(ordersService.cancelOrder).not.toHaveBeenCalled();
        });
    });
});
