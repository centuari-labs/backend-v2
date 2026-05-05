import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { PortfolioService } from "../../portfolio/portfolio.service";
import { Token } from "../../tokens/entities/token.entity";
import { PriceService } from "../../price/price.service";
import { TokensService } from "../../tokens/tokens.service";
import { PortfolioRepository } from "../../portfolio/repositories/portfolio.repository";
import { OrderRepository } from "../../orders/repositories/order.repository";
import { MarketRepositories } from "../../market/repository/market.repository";
import { ViemService } from "../../core/viem/viem.service";
import { ChainConfigService } from "../../core/chain-config/chain-config.service";
import { OrderSide, OrderStatus } from "../../orders/constants/order.constants";
import { DataSource } from "typeorm";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { HEALTH_FACTOR_NO_DEBT } from "../../portfolio/helpers/health-factor.helpers";

describe("PortfolioService", () => {
    let service: PortfolioService;
    let tokenRepositoryMock: jest.Mocked<Repository<Token>>;
    let priceServiceMock: jest.Mocked<PriceService>;
    let tokensServiceMock: jest.Mocked<Partial<TokensService>>;
    let portfolioRepositoryMock: any;
    let orderRepositoryMock: any;

    const mockWalletAddress = "0x1234567890abcdef1234567890abcdef12345678";
    const mockAccountId = "account-uuid-001";

    const mockTokens = [
        {
            id: "token-uuid-001",
            symbol: "ETH",
            name: "Ethereum",
            tokenAddress: "0xETH",
            averageLTV: 0.75,
            decimals: 18,
        },
        {
            id: "token-uuid-002",
            symbol: "BTC",
            name: "Bitcoin",
            tokenAddress: "0xBTC",
            averageLTV: 0.7,
            decimals: 8,
        },
        {
            id: "token-uuid-003",
            symbol: "USDC",
            name: "USD Coin",
            tokenAddress: "0xUSDC",
            averageLTV: 0.85,
            decimals: 6,
        },
    ];

    beforeEach(async () => {
        tokenRepositoryMock = {
            find: jest.fn(),
            createQueryBuilder: jest.fn(),
        } as any;

        priceServiceMock = {
            getPrice: jest.fn(),
            getPrices: jest.fn(),
            getPriceByAssetId: jest.fn(),
        } as any;

        tokensServiceMock = {
            getTokenDecimalsByAssetId: jest.fn(async (assetId: string) => {
                const token = mockTokens.find((t) => t.id === assetId);
                return token?.decimals ?? null;
            }),
        } as any;

        portfolioRepositoryMock = {
            getUserTotalBalances: jest.fn(),
            getUserLendPositionsForApr: jest.fn(),
            getUserSuppliedAssets: jest.fn(),
            getUserBorrowedAssets: jest.fn(),
            getUserCollateralAssets: jest.fn(),
            getUserAssets: jest.fn(),
            getUserPositions: jest.fn(),
            getRiskParamsByCollateralTokenIds: jest.fn().mockResolvedValue([]),
            getAllLendPositions: jest.fn().mockResolvedValue([]),
            getTokensByAssetIds: jest.fn().mockResolvedValue([]),
            getUserDailyLendBorrow: jest.fn().mockResolvedValue([]),
        };

        orderRepositoryMock = {
            findAccountByWallet: jest
                .fn()
                .mockResolvedValue({ id: mockAccountId }),
            getOpenLendAmountsByAccount: jest.fn().mockResolvedValue([]),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PortfolioService,
                {
                    provide: getRepositoryToken(Token),
                    useValue: tokenRepositoryMock,
                },
                { provide: PriceService, useValue: priceServiceMock },
                { provide: TokensService, useValue: tokensServiceMock },
                {
                    provide: PortfolioRepository,
                    useValue: portfolioRepositoryMock,
                },
                { provide: OrderRepository, useValue: orderRepositoryMock },
                { provide: MarketRepositories, useValue: {} },
                { provide: ViemService, useValue: {} },
                {
                    provide: ChainConfigService,
                    useValue: {
                        chainId: 421614,
                        operatorPrivateKey: "",
                        treasuryAddress: "",
                        centuariAddress: "",
                    },
                },
                { provide: DataSource, useValue: {} },
            ],
        }).compile();

        service = module.get<PortfolioService>(PortfolioService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("getMyPortfolio", () => {
        it("should calculate total deposit correctly in USD", async () => {
            tokenRepositoryMock.find.mockResolvedValue(mockTokens as any);
            priceServiceMock.getPrices.mockReturnValue({
                "token-uuid-001": 3000,
                "token-uuid-002": 50000,
                "token-uuid-003": 1,
            });

            // total_amount in base units: 2 ETH (18 dec) = 2e18, 0.5 BTC (8 dec) = 5e7
            portfolioRepositoryMock.getUserTotalBalances.mockResolvedValue([
                {
                    asset_id: "token-uuid-001",
                    total_amount: "2000000000000000000",
                },
                { asset_id: "token-uuid-002", total_amount: "50000000" },
            ]);
            portfolioRepositoryMock.getUserLendPositionsForApr.mockResolvedValue(
                [],
            );
            portfolioRepositoryMock.getUserSuppliedAssets.mockResolvedValue([]);
            portfolioRepositoryMock.getUserBorrowedAssets.mockResolvedValue([]);

            const result = await service.getMyPortfolio(mockWalletAddress);

            // (2 * 3000) + (0.5 * 50000) = 6000 + 25000 = 31000
            expect(result.totalDeposit).toBe(31000);
            expect(result.allocation).toEqual({
                availableBalanceUsd: 31000,
                suppliedAssetsUsd: 0,
                borrowedAssetsUsd: 0,
                availableBalancePct: 100,
                suppliedAssetsPct: 0,
                borrowedAssetsPct: 0,
            });
        });

        it("should calculate net APY (percentage) from a single lend position", async () => {
            tokenRepositoryMock.find.mockResolvedValue(mockTokens as any);
            priceServiceMock.getPrices.mockReturnValue({});

            portfolioRepositoryMock.getUserTotalBalances.mockResolvedValue([]);
            // APR is stored in BPS: apr = 1000 → 1000/10000 = 0.1 → netAPY = 0.1 * 100 = 10%
            // amount in base units: 1000 USDC (6 dec) = 1000000000
            portfolioRepositoryMock.getUserLendPositionsForApr.mockResolvedValue(
                [
                    {
                        asset_id: "token-uuid-003",
                        apr: "1000",
                        amount: "1000000000",
                    },
                ],
            );
            portfolioRepositoryMock.getUserSuppliedAssets.mockResolvedValue([]);
            portfolioRepositoryMock.getUserBorrowedAssets.mockResolvedValue([]);

            const result = await service.getMyPortfolio(mockWalletAddress);

            expect(result.netAPY).toBe(10);
        });

        it("should calculate weighted average net APY (percentage) from multiple lend positions", async () => {
            tokenRepositoryMock.find.mockResolvedValue(mockTokens as any);
            priceServiceMock.getPrices.mockReturnValue({});

            portfolioRepositoryMock.getUserTotalBalances.mockResolvedValue([]);
            // Position 1: USDC, amount = 1000 USDC (base), apr = 500 BPS → 0.05
            // Position 2: USDC, amount = 500 USDC (base), apr = 1000 BPS → 0.10
            // Weighted avg APR = (0.05*1000 + 0.10*500) / 1500 = 100/1500 ≈ 0.0667
            // netAPY = 0.0667 * 100 = 6.67
            portfolioRepositoryMock.getUserLendPositionsForApr.mockResolvedValue(
                [
                    {
                        asset_id: "token-uuid-003",
                        apr: "500",
                        amount: "1000000000",
                    },
                    {
                        asset_id: "token-uuid-003",
                        apr: "1000",
                        amount: "500000000",
                    },
                ],
            );
            portfolioRepositoryMock.getUserSuppliedAssets.mockResolvedValue([]);
            portfolioRepositoryMock.getUserBorrowedAssets.mockResolvedValue([]);

            const result = await service.getMyPortfolio(mockWalletAddress);

            expect(result.netAPY).toBe(6.67);
        });

        it("should return net APR 0 when there are no lend positions", async () => {
            tokenRepositoryMock.find.mockResolvedValue(mockTokens as any);
            priceServiceMock.getPrices.mockReturnValue({});

            portfolioRepositoryMock.getUserTotalBalances.mockResolvedValue([]);
            portfolioRepositoryMock.getUserLendPositionsForApr.mockResolvedValue(
                [],
            );
            portfolioRepositoryMock.getUserSuppliedAssets.mockResolvedValue([]);
            portfolioRepositoryMock.getUserBorrowedAssets.mockResolvedValue([]);

            const result = await service.getMyPortfolio(mockWalletAddress);

            expect(result.netAPY).toBe(0);
        });

        it("should skip positions with zero amount when computing net APY", async () => {
            tokenRepositoryMock.find.mockResolvedValue(mockTokens as any);
            priceServiceMock.getPrices.mockReturnValue({});

            portfolioRepositoryMock.getUserTotalBalances.mockResolvedValue([]);
            // One valid position (10%) and one with amount = 0 (should be skipped)
            portfolioRepositoryMock.getUserLendPositionsForApr.mockResolvedValue(
                [
                    {
                        asset_id: "token-uuid-003",
                        apr: "1000",
                        amount: "1000000000",
                    },
                    {
                        asset_id: "token-uuid-003",
                        apr: "500",
                        amount: "0",
                    },
                ],
            );
            portfolioRepositoryMock.getUserSuppliedAssets.mockResolvedValue([]);
            portfolioRepositoryMock.getUserBorrowedAssets.mockResolvedValue([]);

            const result = await service.getMyPortfolio(mockWalletAddress);

            expect(result.netAPY).toBe(10);
        });

        it("should skip positions with missing decimals", async () => {
            const tokensWithMissingDecimals = [
                ...mockTokens,
                {
                    id: "token-no-decimals",
                    symbol: "NODEC",
                    name: "No Decimals Token",
                    tokenAddress: "0xNODEC",
                    averageLTV: 0,
                    decimals: null,
                },
            ];
            tokenRepositoryMock.find.mockResolvedValue(
                tokensWithMissingDecimals as any,
            );
            priceServiceMock.getPrices.mockReturnValue({});

            portfolioRepositoryMock.getUserTotalBalances.mockResolvedValue([]);
            portfolioRepositoryMock.getUserLendPositionsForApr.mockResolvedValue(
                [
                    {
                        asset_id: "token-no-decimals",
                        apr: "1000",
                        amount: "1000",
                    },
                ],
            );
            portfolioRepositoryMock.getUserSuppliedAssets.mockResolvedValue([]);
            portfolioRepositoryMock.getUserBorrowedAssets.mockResolvedValue([]);

            const result = await service.getMyPortfolio(mockWalletAddress);

            expect(result.netAPY).toBe(0);
        });

        it("should calculate all time return correctly from lend positions and prices", async () => {
            tokenRepositoryMock.find.mockResolvedValue(mockTokens as any);
            // Price of USDC = 1 USD
            priceServiceMock.getPrices.mockReturnValue({
                "token-uuid-003": 1,
            });

            portfolioRepositoryMock.getUserTotalBalances.mockResolvedValue([]);
            portfolioRepositoryMock.getUserLendPositionsForApr.mockResolvedValue(
                [],
            );
            // allLendPositions: USDC, amount = 1000 USDC (base), original_shares = 1100 USDC (base)
            // gain = (1100 - 1000) * $1 = $100
            portfolioRepositoryMock.getAllLendPositions.mockResolvedValue([
                {
                    asset_id: "token-uuid-003",
                    amount: "1000000000",
                    original_shares: "1100000000",
                },
            ]);
            portfolioRepositoryMock.getUserSuppliedAssets.mockResolvedValue([]);
            portfolioRepositoryMock.getUserBorrowedAssets.mockResolvedValue([]);

            const result = await service.getMyPortfolio(mockWalletAddress);

            expect(result.allTimeReturn).toBe(100);
        });

        it("should handle missing price data gracefully", async () => {
            tokenRepositoryMock.find.mockResolvedValue(mockTokens as any);
            priceServiceMock.getPrices.mockReturnValue({});

            portfolioRepositoryMock.getUserTotalBalances.mockResolvedValue([
                {
                    asset_id: "token-uuid-001",
                    total_amount: "2000000000000000000",
                },
            ]);
            portfolioRepositoryMock.getUserLendPositionsForApr.mockResolvedValue(
                [],
            );
            portfolioRepositoryMock.getUserSuppliedAssets.mockResolvedValue([]);
            portfolioRepositoryMock.getUserBorrowedAssets.mockResolvedValue([]);

            const result = await service.getMyPortfolio(mockWalletAddress);

            expect(result.totalDeposit).toBe(0);
        });

        it("should compute allocation percentages from supplied and borrowed assets", async () => {
            tokenRepositoryMock.find.mockResolvedValue(mockTokens as any);
            priceServiceMock.getPrices.mockReturnValue({
                "token-uuid-001": 3000,
                "token-uuid-002": 50000,
            });

            // Total deposit: 2 ETH (base units) -> 6000 USD
            portfolioRepositoryMock.getUserTotalBalances.mockResolvedValue([
                {
                    asset_id: "token-uuid-001",
                    total_amount: "2000000000000000000",
                },
            ]);
            portfolioRepositoryMock.getUserLendPositionsForApr.mockResolvedValue(
                [],
            );

            // Supplied: 1 ETH (base units)
            portfolioRepositoryMock.getUserSuppliedAssets.mockResolvedValue([
                { asset_id: "token-uuid-001", amount: "1000000000000000000" },
            ]);

            // Borrowed: 0.02 BTC (base units for 8 decimals)
            portfolioRepositoryMock.getUserBorrowedAssets.mockResolvedValue([
                { asset_id: "token-uuid-002", amount: "2000000" },
            ]);

            const result = await service.getMyPortfolio(mockWalletAddress);

            // suppliedUsd = 1 * 3000 = 3000
            // borrowedUsd = 0.02 * 50000 = 1000
            // availableUsd = totalDeposit - suppliedUsd = 6000 - 3000 = 3000
            // allocationTotal = 3000 + 3000 + 1000 = 7000
            // availablePct ≈ 42.86, suppliedPct ≈ 42.86, borrowedPct ≈ 14.29
            expect(result.allocation.availableBalanceUsd).toBe(3000);
            expect(result.allocation.suppliedAssetsUsd).toBe(3000);
            expect(result.allocation.borrowedAssetsUsd).toBe(1000);
            expect(result.allocation.availableBalancePct).toBe(42.86);
            expect(result.allocation.suppliedAssetsPct).toBe(42.86);
            expect(result.allocation.borrowedAssetsPct).toBe(14.29);
        });
    });

    describe("getMyAssets", () => {
        it("should return empty result for non-existent account", async () => {
            orderRepositoryMock.findAccountByWallet.mockResolvedValue(null);

            const result = await service.getMyAssets(mockWalletAddress, {
                page: 1,
                limit: 10,
            });

            expect(result.data).toEqual([]);
            expect(result.totalData).toBe(0);
            expect(result.totalPages).toBe(0);
        });

        it("should return paginated user assets with USD amounts", async () => {
            orderRepositoryMock.findAccountByWallet.mockResolvedValue({
                id: mockAccountId,
            });

            portfolioRepositoryMock.getUserAssets.mockResolvedValue({
                data: [
                    {
                        asset_id: "token-uuid-001",
                        amount: "1500000000000000000",
                        is_collateral: true,
                    },
                    {
                        asset_id: "token-uuid-002",
                        amount: "25000000",
                        is_collateral: false,
                    },
                ],
                total: 2,
            });

            portfolioRepositoryMock.getTokensByAssetIds.mockResolvedValue([
                mockTokens[0],
                mockTokens[1],
            ]);

            priceServiceMock.getPrices.mockReturnValue({
                "token-uuid-001": 3000,
                "token-uuid-002": 50000,
            });

            const result = await service.getMyAssets(mockWalletAddress, {
                page: 1,
                limit: 10,
            });

            expect(result.data).toHaveLength(2);
            expect(result.data[0]).toEqual(
                expect.objectContaining({
                    symbol: "ETH",
                    name: "Ethereum",
                    walletBalance: 1.5,
                    amountInUsd: 4500,
                    isCollateral: true,
                    imageUrl: null,
                    ltv: 0,
                    liquidationThreshold: 0,
                }),
            );
            expect(result.data[1]).toEqual(
                expect.objectContaining({
                    symbol: "BTC",
                    name: "Bitcoin",
                    walletBalance: 0.25,
                    amountInUsd: 12500,
                    isCollateral: false,
                    imageUrl: null,
                    ltv: 0,
                    liquidationThreshold: 0,
                }),
            );
            expect(result.totalData).toBe(2);
            expect(result.totalPages).toBe(1);
        });

        it("should handle pagination correctly", async () => {
            orderRepositoryMock.findAccountByWallet.mockResolvedValue({
                id: mockAccountId,
            });

            portfolioRepositoryMock.getUserAssets.mockResolvedValue({
                data: [
                    {
                        asset_id: "token-uuid-001",
                        amount: "1",
                        is_collateral: true,
                    },
                ],
                total: 25,
            });

            portfolioRepositoryMock.getTokensByAssetIds.mockResolvedValue([
                mockTokens[0],
            ]);
            const prices = {};
            mockTokens.forEach((t) => {
                prices[t.tokenAddress.toLowerCase()] = 3000;
            });
            priceServiceMock.getPrices.mockReturnValue(prices);

            const result = await service.getMyAssets(mockWalletAddress, {
                page: 2,
                limit: 10,
            });

            expect(result.page).toBe(2);
            expect(result.limit).toBe(10);
            expect(result.totalData).toBe(25);
            expect(result.totalPages).toBe(3);
        });

        it("should return 0 USD for missing price data", async () => {
            orderRepositoryMock.findAccountByWallet.mockResolvedValue({
                id: mockAccountId,
            });

            portfolioRepositoryMock.getUserAssets.mockResolvedValue({
                data: [
                    {
                        asset_id: "token-uuid-001",
                        amount: "1500000000000000000",
                        is_collateral: true,
                    },
                ],
                total: 1,
            });

            portfolioRepositoryMock.getTokensByAssetIds.mockResolvedValue([
                mockTokens[0],
            ]);
            priceServiceMock.getPrices.mockReturnValue({});

            const result = await service.getMyAssets(mockWalletAddress, {
                page: 1,
                limit: 10,
            });

            expect(result.data[0].amountInUsd).toBe(0);
        });
    });

    describe("getMyPosition", () => {
        it("should throw NotFoundException for non-existent account", async () => {
            orderRepositoryMock.findAccountByWallet.mockResolvedValue(null);

            await expect(
                service.getMyPosition(mockWalletAddress, {
                    page: 1,
                    limit: 10,
                }),
            ).rejects.toThrow("Account not found");
        });

        it("should return all positions when no type filter is provided", async () => {
            orderRepositoryMock.findAccountByWallet.mockResolvedValue({
                id: mockAccountId,
            });

            portfolioRepositoryMock.getUserPositions.mockResolvedValue({
                data: [
                    {
                        order_id: "order-001",
                        asset_id: "token-uuid-001",
                        side: OrderSide.Lend,
                        rate: "5.5",
                        quantity: "1000",
                        filled_quantity: "200",
                        status: OrderStatus.Open,
                        symbol: "ETH",
                        name: "Ethereum",
                        token_address: "0xETH",
                    },
                    {
                        order_id: "order-002",
                        asset_id: "token-uuid-002",
                        side: OrderSide.Borrow,
                        rate: "8.0",
                        quantity: "500",
                        filled_quantity: "100",
                        status: OrderStatus.PartiallyFilled,
                        symbol: "BTC",
                        name: "Bitcoin",
                        token_address: "0xBTC",
                    },
                ],
                total: 2,
            });

            const mockQueryBuilder = {
                select: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                getMany: jest
                    .fn()
                    .mockResolvedValue([mockTokens[0], mockTokens[1]]),
            };
            tokenRepositoryMock.createQueryBuilder.mockReturnValue(
                mockQueryBuilder as any,
            );

            priceServiceMock.getPrices.mockReturnValue({
                "0xeth": 3000,
                "0xbtc": 50000,
            });

            const result = await service.getMyPosition(mockWalletAddress, {
                page: 1,
                limit: 10,
            });

            expect(result.data).toHaveLength(2);
            expect(result.totalData).toBe(2);
        });

        it("should filter by LEND positions when type is LEND", async () => {
            orderRepositoryMock.findAccountByWallet.mockResolvedValue({
                id: mockAccountId,
            });

            portfolioRepositoryMock.getUserPositions.mockResolvedValue({
                data: [
                    {
                        order_id: "order-001",
                        asset_id: "token-uuid-001",
                        side: OrderSide.Lend,
                        rate: "5.5",
                        quantity: "1000",
                        filled_quantity: "200",
                        status: OrderStatus.Open,
                        symbol: "ETH",
                        name: "Ethereum",
                        token_address: "0xETH",
                    },
                ],
                total: 1,
            });

            const mockQueryBuilder = {
                select: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                getMany: jest.fn().mockResolvedValue([mockTokens[0]]),
            };
            tokenRepositoryMock.createQueryBuilder.mockReturnValue(
                mockQueryBuilder as any,
            );
            priceServiceMock.getPrices.mockReturnValue({ "0xeth": 3000 });

            const result = await service.getMyPosition(mockWalletAddress, {
                page: 1,
                limit: 10,
                type: "LEND",
            });

            expect(
                portfolioRepositoryMock.getUserPositions,
            ).toHaveBeenCalledWith(mockAccountId, "LEND", 1, 10, undefined);
            expect(result.data).toHaveLength(1);
        });

        it("should filter by BORROW positions when type is BORROW", async () => {
            orderRepositoryMock.findAccountByWallet.mockResolvedValue({
                id: mockAccountId,
            });

            portfolioRepositoryMock.getUserPositions.mockResolvedValue({
                data: [
                    {
                        order_id: "order-002",
                        asset_id: "token-uuid-002",
                        side: OrderSide.Borrow,
                        rate: "8.0",
                        quantity: "500",
                        filled_quantity: "100",
                        status: OrderStatus.PartiallyFilled,
                        symbol: "BTC",
                        name: "Bitcoin",
                        token_address: "0xBTC",
                    },
                ],
                total: 1,
            });

            const mockQueryBuilder = {
                select: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                getMany: jest.fn().mockResolvedValue([mockTokens[1]]),
            };
            tokenRepositoryMock.createQueryBuilder.mockReturnValue(
                mockQueryBuilder as any,
            );
            priceServiceMock.getPrices.mockReturnValue({ "0xbtc": 50000 });

            const result = await service.getMyPosition(mockWalletAddress, {
                page: 1,
                limit: 10,
                type: "BORROW",
            });

            expect(
                portfolioRepositoryMock.getUserPositions,
            ).toHaveBeenCalledWith(mockAccountId, "BORROW", 1, 10, undefined);
            expect(result.data).toHaveLength(1);
        });

        it("should return position quantity as walletBalance", async () => {
            orderRepositoryMock.findAccountByWallet.mockResolvedValue({
                id: mockAccountId,
            });

            // token-uuid-001 is ETH with 18 decimals; quantity = 1000 ETH in base units
            portfolioRepositoryMock.getUserPositions.mockResolvedValue({
                data: [
                    {
                        position_id: "market-001",
                        market_id: "market-001",
                        asset_id: "token-uuid-001",
                        side: OrderSide.Lend,
                        rate: "5.5",
                        quantity: "1000000000000000000000",
                        base_amount: "1000000000000000000000",
                    },
                ],
                total: 1,
            });

            priceServiceMock.getPrices.mockReturnValue({
                "token-uuid-001": 3000,
            });

            const result = await service.getMyPosition(mockWalletAddress, {
                page: 1,
                limit: 10,
            });

            expect(result.data[0].shares).toBe(1000);
        });

        it("should calculate USD amount correctly for positions", async () => {
            orderRepositoryMock.findAccountByWallet.mockResolvedValue({
                id: mockAccountId,
            });

            // token-uuid-001 is ETH with 18 decimals; quantity = 2 ETH in base units
            portfolioRepositoryMock.getUserPositions.mockResolvedValue({
                data: [
                    {
                        position_id: "market-001",
                        market_id: "market-001",
                        asset_id: "token-uuid-001",
                        side: OrderSide.Lend,
                        rate: "5.5",
                        quantity: "2000000000000000000",
                        base_amount: "2000000000000000000",
                    },
                ],
                total: 1,
            });

            priceServiceMock.getPrices.mockReturnValue({
                "token-uuid-001": 3000,
            });

            const result = await service.getMyPosition(mockWalletAddress, {
                page: 1,
                limit: 10,
            });

            // quantity = 2 ETH, price = 3000 → USD = 6000
            expect(result.data[0].amountInUsd).toBe(6000);
        });

        it("should handle missing price data for positions", async () => {
            orderRepositoryMock.findAccountByWallet.mockResolvedValue({
                id: mockAccountId,
            });

            portfolioRepositoryMock.getUserPositions.mockResolvedValue({
                data: [
                    {
                        order_id: "order-001",
                        asset_id: "token-uuid-001",
                        side: OrderSide.Lend,
                        rate: "5.5",
                        quantity: "1000",
                        filled_quantity: "200",
                        status: OrderStatus.Open,
                        symbol: "ETH",
                        name: "Ethereum",
                        token_address: "0xETH",
                    },
                ],
                total: 1,
            });

            const mockQueryBuilder = {
                select: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                getMany: jest.fn().mockResolvedValue([mockTokens[0]]),
            };
            tokenRepositoryMock.createQueryBuilder.mockReturnValue(
                mockQueryBuilder as any,
            );
            priceServiceMock.getPrices.mockReturnValue({});

            const result = await service.getMyPosition(mockWalletAddress, {
                page: 1,
                limit: 10,
            });

            expect(result.data[0].amountInUsd).toBe(0);
        });

        it("should return isCollateral as false for positions", async () => {
            orderRepositoryMock.findAccountByWallet.mockResolvedValue({
                id: mockAccountId,
            });

            portfolioRepositoryMock.getUserPositions.mockResolvedValue({
                data: [
                    {
                        order_id: "order-001",
                        asset_id: "token-uuid-001",
                        side: OrderSide.Lend,
                        rate: "5.5",
                        quantity: "1000",
                        filled_quantity: "200",
                        status: OrderStatus.Open,
                        symbol: "ETH",
                        name: "Ethereum",
                        token_address: "0xETH",
                    },
                ],
                total: 1,
            });

            const mockQueryBuilder = {
                select: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                getMany: jest.fn().mockResolvedValue([mockTokens[0]]),
            };
            tokenRepositoryMock.createQueryBuilder.mockReturnValue(
                mockQueryBuilder as any,
            );
            priceServiceMock.getPrices.mockReturnValue({ "0xeth": 3000 });

            const result = await service.getMyPosition(mockWalletAddress, {
                page: 1,
                limit: 10,
            });

            expect(result.data[0].isCollateral).toBe(false);
        });
        describe("getLendBorrowAssets", () => {
            it("should return supplied lend assets USD, debt USD and health factor", async () => {
                orderRepositoryMock.findAccountByWallet.mockResolvedValue({
                    id: mockAccountId,
                });
                const tokensWithDecimals = mockTokens.map((t) => ({
                    ...t,
                    decimals:
                        t.id === "token-uuid-001"
                            ? 18
                            : t.id === "token-uuid-002"
                              ? 8
                              : 6,
                    averageLTV: 7500, // 75% in basis points
                }));
                tokenRepositoryMock.find.mockResolvedValue(
                    tokensWithDecimals as any,
                );
                priceServiceMock.getPrices.mockReturnValue({
                    "token-uuid-001": 3000,
                    "token-uuid-002": 50000,
                    "token-uuid-003": 1,
                });

                // Collateral (used for health factor calculation only)
                portfolioRepositoryMock.getUserCollateralAssets.mockResolvedValue(
                    [
                        {
                            asset_id: "token-uuid-001",
                            amount: "2000000000000000000",
                        },
                    ],
                );
                // Supplied lend assets (used for suppliedAssets field)
                portfolioRepositoryMock.getUserSuppliedAssets.mockResolvedValue(
                    [
                        { asset_id: "token-uuid-003", amount: "5000000000" }, // 5000 USDC (6 decimals)
                    ],
                );
                // Borrowed
                portfolioRepositoryMock.getUserBorrowedAssets.mockResolvedValue(
                    [{ asset_id: "token-uuid-002", amount: "10000000" }],
                );

                const result =
                    await service.getLendBorrowAssets(mockWalletAddress);

                expect(result.suppliedAssets).toBe(5000); // 5000 USDC * $1
                expect(result.borrowedAssets).toBe(5000); // 0.1 BTC * $50000
                // HF = ((6000 - 5000) * 0.75) / 5000 = 0.15
                expect(result.healthFactor).toBe(0.15);
            });

            it("should handle zero borrowed amount correctly", async () => {
                orderRepositoryMock.findAccountByWallet.mockResolvedValue({
                    id: mockAccountId,
                });
                const tokensWithDecimals = mockTokens.map((t) => ({
                    ...t,
                    decimals: 18,
                    averageLTV: 7500,
                }));
                tokenRepositoryMock.find.mockResolvedValue(
                    tokensWithDecimals as any,
                );
                priceServiceMock.getPrices.mockReturnValue({
                    "token-uuid-001": 3000,
                });

                portfolioRepositoryMock.getUserCollateralAssets.mockResolvedValue(
                    [
                        {
                            asset_id: "token-uuid-001",
                            amount: "1000000000000000000",
                        },
                    ],
                );
                // Supplied lend assets: 1 ETH
                portfolioRepositoryMock.getUserSuppliedAssets.mockResolvedValue(
                    [
                        {
                            asset_id: "token-uuid-001",
                            amount: "1000000000000000000",
                        },
                    ],
                );
                portfolioRepositoryMock.getUserBorrowedAssets.mockResolvedValue(
                    [],
                );

                const result =
                    await service.getLendBorrowAssets(mockWalletAddress);

                expect(result.suppliedAssets).toBe(3000); // 1 ETH * $3000
                expect(result.borrowedAssets).toBe(0);
                expect(result.healthFactor).toBe(0); // no debt -> formatted as 0 in response
            });

            it("should throw NotFoundException for non-existent account", async () => {
                orderRepositoryMock.findAccountByWallet.mockResolvedValue(null);

                await expect(
                    service.getLendBorrowAssets(mockWalletAddress),
                ).rejects.toThrow("Account not found");
            });
        });

        describe("simulateHealthFactorAfterWithdrawal", () => {
            it("should clamp reduction to 0 when it exceeds balance", async () => {
                tokenRepositoryMock.find.mockResolvedValue(
                    mockTokens.map((t) => ({
                        ...t,
                        decimals: 18,
                        averageLTV: 7500,
                    })) as any,
                );
                priceServiceMock.getPrices.mockReturnValue({
                    "token-uuid-001": 3000,
                });
                portfolioRepositoryMock.getUserCollateralAssets.mockResolvedValue(
                    [
                        {
                            asset_id: "token-uuid-001",
                            amount: "1000000000000000000", // 1 ETH
                        },
                    ],
                );
                portfolioRepositoryMock.getUserBorrowedAssets.mockResolvedValue(
                    [],
                );
                portfolioRepositoryMock.getRiskParamsByCollateralTokenIds.mockResolvedValue(
                    [{ asset_id: "token-uuid-001", avg_ltv: "0.75" }],
                );

                // Reduce by 2 ETH (more than the 1 ETH balance) → should clamp to 0
                const result =
                    await service.simulateHealthFactorAfterWithdrawal(
                        mockAccountId,
                        "token-uuid-001",
                        "2000000000000000000",
                    );

                // With 0 collateral and 0 debt, HF should be infinity (no debt)
                expect(result.healthFactor).toBe(HEALTH_FACTOR_NO_DEBT);
            });

            it("should handle account with no collateral positions", async () => {
                tokenRepositoryMock.find.mockResolvedValue([] as any);
                priceServiceMock.getPrices.mockReturnValue({});
                portfolioRepositoryMock.getUserCollateralAssets.mockResolvedValue(
                    [],
                );
                portfolioRepositoryMock.getUserBorrowedAssets.mockResolvedValue(
                    [],
                );
                portfolioRepositoryMock.getRiskParamsByCollateralTokenIds.mockResolvedValue(
                    [],
                );

                const result =
                    await service.simulateHealthFactorAfterWithdrawal(
                        mockAccountId,
                        "token-uuid-001",
                        "0",
                    );

                expect(result.healthFactor).toBe(HEALTH_FACTOR_NO_DEBT);
            });
        });

        describe("calculateOpenBorrowOrdersUsd", () => {
            it("should return 0 when no open borrow orders", async () => {
                orderRepositoryMock.getOpenBorrowOrders = jest
                    .fn()
                    .mockResolvedValue([]);
                priceServiceMock.getPrices.mockReturnValue({});

                const result =
                    await service.calculateOpenBorrowOrdersUsd(mockAccountId);

                expect(result).toBe(0);
            });

            it("should skip orders with null price", async () => {
                orderRepositoryMock.getOpenBorrowOrders = jest
                    .fn()
                    .mockResolvedValue([
                        {
                            assetId: "token-uuid-001",
                            quantity: "1000000000000000000",
                            filledQuantity: "0",
                        },
                    ]);
                priceServiceMock.getPrices.mockReturnValue({}); // no price for token-uuid-001

                const result =
                    await service.calculateOpenBorrowOrdersUsd(mockAccountId);

                expect(result).toBe(0);
            });

            it("should skip orders with null decimals", async () => {
                orderRepositoryMock.getOpenBorrowOrders = jest
                    .fn()
                    .mockResolvedValue([
                        {
                            assetId: "unknown-token",
                            quantity: "1000000",
                            filledQuantity: "0",
                        },
                    ]);
                priceServiceMock.getPrices.mockReturnValue({
                    "unknown-token": 100,
                });

                const result =
                    await service.calculateOpenBorrowOrdersUsd(mockAccountId);

                // tokensServiceMock.getTokenDecimalsByAssetId returns null for unknown tokens
                expect(result).toBe(0);
            });
        });

        describe("checkAvailableBalanceForLend", () => {
            it("should throw when balance insufficient after fees", async () => {
                portfolioRepositoryMock.getUserTotalBalances.mockResolvedValue([
                    { asset_id: "token-uuid-001", total_amount: "1000" },
                ]);
                portfolioRepositoryMock.findOne = jest
                    .fn()
                    .mockResolvedValue({ lockedAmount: "0" });
                orderRepositoryMock.getTotalOpenQuantity = jest
                    .fn()
                    .mockResolvedValue(0n);

                // Balance is 1000, requesting 900 + 200 fees = 1100 > 1000
                await expect(
                    service.checkAvailableBalanceForLend(
                        mockAccountId,
                        "token-uuid-001",
                        "900",
                        "100",
                        "100",
                    ),
                ).rejects.toThrow(BadRequestException);
            });

            it("should pass when balance exactly matches required", async () => {
                portfolioRepositoryMock.getUserTotalBalances.mockResolvedValue([
                    { asset_id: "token-uuid-001", total_amount: "1000" },
                ]);
                portfolioRepositoryMock.findOne = jest
                    .fn()
                    .mockResolvedValue(null);
                orderRepositoryMock.getTotalOpenQuantity = jest
                    .fn()
                    .mockResolvedValue(0n);

                // Balance is 1000, requesting exactly 1000
                await expect(
                    service.checkAvailableBalanceForLend(
                        mockAccountId,
                        "token-uuid-001",
                        "1000",
                        "0",
                        "0",
                    ),
                ).resolves.toBeUndefined();
            });

            it("should handle zero locked amount", async () => {
                portfolioRepositoryMock.getUserTotalBalances.mockResolvedValue([
                    { asset_id: "token-uuid-001", total_amount: "5000" },
                ]);
                portfolioRepositoryMock.findOne = jest
                    .fn()
                    .mockResolvedValue(null);
                orderRepositoryMock.getTotalOpenQuantity = jest
                    .fn()
                    .mockResolvedValue(0n);

                await expect(
                    service.checkAvailableBalanceForLend(
                        mockAccountId,
                        "token-uuid-001",
                        "3000",
                    ),
                ).resolves.toBeUndefined();
            });
        });

        describe("checkAvailableBalanceForBorrowFees", () => {
            it("should return early when fees are zero", async () => {
                // Should not even call getAssetBalance
                await expect(
                    service.checkAvailableBalanceForBorrowFees(
                        mockAccountId,
                        "token-uuid-001",
                        "0",
                        "0",
                    ),
                ).resolves.toBeUndefined();

                expect(
                    portfolioRepositoryMock.getUserTotalBalances,
                ).not.toHaveBeenCalled();
            });

            it("should throw when balance insufficient for fees", async () => {
                portfolioRepositoryMock.getUserTotalBalances.mockResolvedValue([
                    { asset_id: "token-uuid-001", total_amount: "100" },
                ]);
                portfolioRepositoryMock.findOne = jest
                    .fn()
                    .mockResolvedValue(null);
                tokensServiceMock.getTokenByAssetId = jest
                    .fn()
                    .mockResolvedValue({
                        symbol: "ETH",
                    });

                await expect(
                    service.checkAvailableBalanceForBorrowFees(
                        mockAccountId,
                        "token-uuid-001",
                        "200",
                        "100",
                    ),
                ).rejects.toThrow(BadRequestException);
            });
        });

        describe("setAssetAsCollateral", () => {
            it("should skip HF check when enabling collateral", async () => {
                portfolioRepositoryMock.setAssetAsCollateral = jest
                    .fn()
                    .mockResolvedValue(undefined);

                await service.setAssetAsCollateral(mockWalletAddress, {
                    assetIds: ["token-uuid-001"],
                    isCollateral: true,
                } as any);

                // Should not call buildHealthFactorInputs (no collateral/debt fetches)
                expect(
                    portfolioRepositoryMock.getUserCollateralAssets,
                ).not.toHaveBeenCalled();
                expect(
                    portfolioRepositoryMock.setAssetAsCollateral,
                ).toHaveBeenCalledWith(mockAccountId, ["token-uuid-001"], true);
            });

            it("should perform HF check when disabling with debt — reject if HF < MIN", async () => {
                tokenRepositoryMock.find.mockResolvedValue(
                    mockTokens.map((t) => ({
                        ...t,
                        decimals: 18,
                        averageLTV: 7500,
                    })) as any,
                );
                priceServiceMock.getPrices.mockReturnValue({
                    "token-uuid-001": 3000,
                    "token-uuid-002": 50000,
                });
                portfolioRepositoryMock.getUserCollateralAssets.mockResolvedValue(
                    [
                        {
                            asset_id: "token-uuid-001",
                            amount: "1000000000000000000", // 1 ETH = $3000
                        },
                    ],
                );
                portfolioRepositoryMock.getUserBorrowedAssets.mockResolvedValue(
                    [
                        {
                            asset_id: "token-uuid-002",
                            amount: "100000000", // 1 BTC = $50000
                        },
                    ],
                );
                portfolioRepositoryMock.getRiskParamsByCollateralTokenIds.mockResolvedValue(
                    [{ asset_id: "token-uuid-001", avg_ltv: "0.75" }],
                );

                // Disabling token-uuid-001 (the only collateral) with outstanding debt
                await expect(
                    service.setAssetAsCollateral(mockWalletAddress, {
                        assetIds: ["token-uuid-001"],
                        isCollateral: false,
                    } as any),
                ).rejects.toThrow(BadRequestException);
            });

            it("should skip HF check when disabling without debt", async () => {
                tokenRepositoryMock.find.mockResolvedValue([] as any);
                priceServiceMock.getPrices.mockReturnValue({});
                portfolioRepositoryMock.getUserCollateralAssets.mockResolvedValue(
                    [
                        {
                            asset_id: "token-uuid-001",
                            amount: "1000000000000000000",
                        },
                    ],
                );
                portfolioRepositoryMock.getUserBorrowedAssets.mockResolvedValue(
                    [],
                );
                portfolioRepositoryMock.getRiskParamsByCollateralTokenIds.mockResolvedValue(
                    [],
                );
                portfolioRepositoryMock.setAssetAsCollateral = jest
                    .fn()
                    .mockResolvedValue(undefined);

                await service.setAssetAsCollateral(mockWalletAddress, {
                    assetIds: ["token-uuid-001"],
                    isCollateral: false,
                } as any);

                expect(
                    portfolioRepositoryMock.setAssetAsCollateral,
                ).toHaveBeenCalled();
            });
        });

        describe("getOrderHistory / getOpenOrders", () => {
            it("should return empty pagination when no account found", async () => {
                orderRepositoryMock.findAccountByWallet.mockResolvedValue(null);

                const result = await service.getOrderHistory(
                    mockWalletAddress,
                    {
                        page: 1,
                        limit: 10,
                    } as any,
                );

                expect(result.data).toEqual([]);
                expect(result.totalData).toBe(0);
            });

            it("should convert rate from BPS to percentage correctly", async () => {
                portfolioRepositoryMock.getOrderHistory = jest
                    .fn()
                    .mockResolvedValue({
                        data: [
                            {
                                id: "order-001",
                                side: "Lend",
                                order_type: "Limit",
                                rate: "500", // 500 BPS = 5%
                                amount: "1000000",
                                filled_quantity: null,
                                status: "Open",
                                cancel_reason: null,
                                asset_id: "token-uuid-003",
                                name: "USDC",
                                symbol: "USDC",
                                decimals: "6",
                                image_url: null,
                                token_address: "0xUSDC",
                                maturity: null,
                                total_fee: null,
                                created_at: "2025-01-01T00:00:00.000Z",
                            },
                        ],
                        total: 1,
                    });

                const result = await service.getOrderHistory(
                    mockWalletAddress,
                    {
                        page: 1,
                        limit: 10,
                    } as any,
                );

                // rate 500 BPS → toPercentage(500) = 500/10000 * 100 = 5
                expect(result.data[0].rate).toBe(5);
            });
        });

        describe("getMyHealthFactor", () => {
            it("should return formatted health factor for account", async () => {
                orderRepositoryMock.findAccountByWallet.mockResolvedValue({
                    id: mockAccountId,
                });
                const tokensWithDecimals = mockTokens.map((t) => ({
                    ...t,
                    decimals: 18,
                    averageLTV: 7500,
                }));
                tokenRepositoryMock.find.mockResolvedValue(
                    tokensWithDecimals as any,
                );
                priceServiceMock.getPrices.mockReturnValue({
                    "token-uuid-001": 3000,
                });

                portfolioRepositoryMock.getUserCollateralAssets.mockResolvedValue(
                    [
                        {
                            asset_id: "token-uuid-001",
                            amount: "1000000000000000000",
                        },
                    ],
                );
                portfolioRepositoryMock.getUserBorrowedAssets.mockResolvedValue(
                    [],
                );

                const result =
                    await service.getMyHealthFactor(mockWalletAddress);

                expect(result.collateralUsd).toBe(3000);
                expect(result.debtUsd).toBe(0);
                expect(result.weightedLtv).toBe(0.75);
                expect(result.healthFactor).toBe(Number.POSITIVE_INFINITY);
            });
        });
    });
});
