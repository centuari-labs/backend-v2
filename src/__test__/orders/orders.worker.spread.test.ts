import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ConfigService } from "@nestjs/config";
import { OrdersWorker } from "../../orders/orders.worker";
import { OrderRepository } from "../../orders/repositories/order.repository";
import { OrdersService } from "../../orders/orders.service";
import { LegacyMarket as Market } from "../../market/entities/legacy-market.entity";
import { Token } from "../../tokens/entities/token.entity";
import { ViemService } from "../../core/viem/viem.service";
import { ChainConfigService } from "../../core/chain-config/chain-config.service";
import { FaucetService } from "../../faucet/faucet.service";
import { PortfolioService } from "../../portfolio/portfolio.service";
import { PortfolioRepository } from "../../portfolio/repositories/portfolio.repository";
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

/**
 * Tests the spread-cancel behavior: after a bot order is placed, if the
 * resulting (bestAsk - bestBid) / bestBid exceeds 1%, the worker must cancel
 * the order it just placed.
 */
describe("OrdersWorker — spread cancel after placement", () => {
    let worker: OrdersWorker;
    let orderRepository: jest.Mocked<OrderRepository>;
    let ordersService: jest.Mocked<OrdersService>;
    let marketRepository: jest.Mocked<Repository<Market>>;
    let tokenRepository: jest.Mocked<Repository<Token>>;

    const MOCK_BOT_WALLET = "0xBotWallet";
    const MOCK_ACCOUNT_ID = "b0000000-0000-0000-0000-000000000001";
    const MOCK_ASSET_ID = MOCK_IDS.assetId;
    const MOCK_PLACED_ORDER_ID = "placed-order-1";

    beforeEach(async () => {
        process.env.NODE_ENV = "development";
        process.env.ORDER_WORKER_ENABLED = "true";

        const mockOrderRepo = createMockOrderRepository();
        const mockMarketRepo = createMockRepository<Market>();
        const mockTokenRepo = createMockRepository<Token>();
        const mockOrdersService = createMockOrdersService();

        mockOrderRepo.getBestRatesForAsset = jest.fn();
        mockOrderRepo.findAccountByWallet = jest.fn().mockResolvedValue({
            id: MOCK_ACCOUNT_ID,
            privyUserId: "did:privy:bot",
            userWallet: MOCK_BOT_WALLET,
        });
        mockOrderRepo.getTotalOpenQuantity = jest.fn().mockResolvedValue(0n);
        mockOrdersService.cancelOrder = jest.fn().mockResolvedValue({});
        mockOrdersService.createLendLimitOrder = jest
            .fn()
            .mockResolvedValue({ orderId: MOCK_PLACED_ORDER_ID });
        mockOrdersService.createBorrowLimitOrder = jest
            .fn()
            .mockResolvedValue({ orderId: MOCK_PLACED_ORDER_ID });

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
                        getHealthFactorForAccount: jest
                            .fn()
                            .mockResolvedValue({ healthFactor: Infinity }),
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
        ordersService = module.get(OrdersService) as jest.Mocked<OrdersService>;
        marketRepository = module.get(
            getRepositoryToken(Market),
        ) as jest.Mocked<Repository<Market>>;
        tokenRepository = module.get(getRepositoryToken(Token)) as jest.Mocked<
            Repository<Token>
        >;

        // Single bot account so only one placement happens per cycle per side.
        (worker as any).botAccounts = [
            {
                privateKey: "0x123",
                wallet: MOCK_BOT_WALLET,
                privyUserId: "did:privy:bot",
            },
        ];
        (worker as any).initialized = true;

        // Force placeOrders to take the deterministic both-sides branch.
        jest.spyOn(Math, "random").mockReturnValue(0);

        const market = createMockMarket({ id: "m1", assetId: MOCK_ASSET_ID });
        const token = createMockToken({ id: MOCK_ASSET_ID, symbol: "USDC" });
        marketRepository.find.mockResolvedValue([market]);
        tokenRepository.find.mockResolvedValue([token]);
        await worker.refreshAssetMarketCache();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("does NOT cancel when post-placement spread is exactly 1%", async () => {
        // bestAsk=505, bestBid=500 → (505-500)/500 = 0.01 = 1% (not >)
        orderRepository.getBestRatesForAsset.mockResolvedValue({
            bestLendRate: 505,
            bestBorrowRate: 500,
        });

        await worker.placeOrders();

        expect(ordersService.createLendLimitOrder).toHaveBeenCalled();
        expect(ordersService.cancelOrder).not.toHaveBeenCalled();
    });

    it("cancels the just-placed order when post-placement spread > 1%", async () => {
        // bestAsk=506, bestBid=500 → (506-500)/500 = 0.012 = 1.2%
        orderRepository.getBestRatesForAsset.mockResolvedValue({
            bestLendRate: 506,
            bestBorrowRate: 500,
        });

        await worker.placeOrders();

        expect(ordersService.cancelOrder).toHaveBeenCalledWith(
            MOCK_PLACED_ORDER_ID,
            MOCK_BOT_WALLET,
        );
    });

    it("does NOT cancel when bestBid is zero or null (avoid division by zero)", async () => {
        orderRepository.getBestRatesForAsset.mockResolvedValue({
            bestLendRate: 510,
            bestBorrowRate: 0,
        });

        await worker.placeOrders();

        expect(ordersService.cancelOrder).not.toHaveBeenCalled();
    });

    it("does NOT cancel when one side of the book is empty", async () => {
        orderRepository.getBestRatesForAsset.mockResolvedValue({
            bestLendRate: 510,
            bestBorrowRate: null,
        });

        await worker.placeOrders();

        expect(ordersService.cancelOrder).not.toHaveBeenCalled();
    });

    it("does not throw if cancelOrder fails (logged and swallowed)", async () => {
        orderRepository.getBestRatesForAsset.mockResolvedValue({
            bestLendRate: 600,
            bestBorrowRate: 500,
        });
        ordersService.cancelOrder.mockRejectedValue(new Error("boom"));

        await expect(worker.placeOrders()).resolves.not.toThrow();
    });
});
