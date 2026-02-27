import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PortfolioService } from '../../portfolio/portfolio.service';
import { Token } from '../../tokens/entities/token.entity';
import { PriceService } from '../../price/price.service';
import { TokensService } from '../../tokens/tokens.service';
import { PortfolioRepository } from '../../portfolio/repositories/portfolio.repository';
import { OrderRepository } from '../../orders/repositories/order.repository';
import { OrderSide, OrderStatus } from '../../orders/constants/order.constants';

describe('PortfolioService', () => {
    let service: PortfolioService;
    let tokenRepositoryMock: jest.Mocked<Repository<Token>>;
    let priceServiceMock: jest.Mocked<PriceService>;
    let tokensServiceMock: jest.Mocked<Partial<TokensService>>;
    let portfolioRepositoryMock: any;
    let orderRepositoryMock: any;

    const mockWalletAddress = '0x1234567890abcdef1234567890abcdef12345678';
    const mockAccountId = 'account-uuid-001';

    const mockTokens = [
        { id: 'token-uuid-001', symbol: 'ETH', name: 'Ethereum', tokenAddress: '0xETH', averageLTV: 0.75, decimals: 18 },
        { id: 'token-uuid-002', symbol: 'BTC', name: 'Bitcoin', tokenAddress: '0xBTC', averageLTV: 0.70, decimals: 8 },
        { id: 'token-uuid-003', symbol: 'USDC', name: 'USD Coin', tokenAddress: '0xUSDC', averageLTV: 0.85, decimals: 6 },
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
        };

        orderRepositoryMock = {
            findAccountByWallet: jest.fn().mockResolvedValue({ id: mockAccountId }),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PortfolioService,
                { provide: getRepositoryToken(Token), useValue: tokenRepositoryMock },
                { provide: PriceService, useValue: priceServiceMock },
                { provide: TokensService, useValue: tokensServiceMock },
                { provide: PortfolioRepository, useValue: portfolioRepositoryMock },
                { provide: OrderRepository, useValue: orderRepositoryMock },
            ],
        }).compile();

        service = module.get<PortfolioService>(PortfolioService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('getMyPortfolio', () => {
        it('should calculate total deposit correctly in USD', async () => {
            tokenRepositoryMock.find.mockResolvedValue(mockTokens as any);
            priceServiceMock.getPrices.mockReturnValue({
                'token-uuid-001': 3000,
                'token-uuid-002': 50000,
                'token-uuid-003': 1,
            });

            portfolioRepositoryMock.getUserTotalBalances.mockResolvedValue([
                { asset_id: 'token-uuid-001', total_amount: '2' },
                { asset_id: 'token-uuid-002', total_amount: '0.5' },
            ]);
            portfolioRepositoryMock.getUserLendPositionsForApr.mockResolvedValue([]);
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

        it('should calculate net APY (percentage) from a single lend position', async () => {
            tokenRepositoryMock.find.mockResolvedValue(mockTokens as any);
            priceServiceMock.getPrices.mockReturnValue({});

            portfolioRepositoryMock.getUserTotalBalances.mockResolvedValue([]);
            // USDC (6 decimals): amount = 1000 USDC, shares = 1100 USDC
            // APR = 1100/1000 - 1 = 0.1 → APY = 10 (%)
            portfolioRepositoryMock.getUserLendPositionsForApr.mockResolvedValue([
                { asset_id: 'token-uuid-003', shares: '1100000000', amount: '1000000000', created_at: new Date() },
            ]);
            portfolioRepositoryMock.getUserSuppliedAssets.mockResolvedValue([]);
            portfolioRepositoryMock.getUserBorrowedAssets.mockResolvedValue([]);

            const result = await service.getMyPortfolio(mockWalletAddress);

            expect(result.netAPY).toBe(10);
        });

        it('should calculate weighted average net APY (percentage) from multiple lend positions', async () => {
            tokenRepositoryMock.find.mockResolvedValue(mockTokens as any);
            priceServiceMock.getPrices.mockReturnValue({});

            portfolioRepositoryMock.getUserTotalBalances.mockResolvedValue([]);
            // Position 1: USDC (6 dec), amount = 1000 USDC, shares = 1050 → APR = 0.05, weight = 1000
            // Position 2: USDC (6 dec), amount = 500 USDC,  shares = 550  → APR = 0.10, weight = 500
            // Weighted avg APR = (0.05*1000 + 0.10*500) / (1000+500) = (50+50)/1500 = 0.0667 → APY ≈ 6.67 (%)
            portfolioRepositoryMock.getUserLendPositionsForApr.mockResolvedValue([
                { asset_id: 'token-uuid-003', shares: '1050000000', amount: '1000000000', created_at: new Date() },
                { asset_id: 'token-uuid-003', shares: '550000000', amount: '500000000', created_at: new Date() },
            ]);
            portfolioRepositoryMock.getUserSuppliedAssets.mockResolvedValue([]);
            portfolioRepositoryMock.getUserBorrowedAssets.mockResolvedValue([]);

            const result = await service.getMyPortfolio(mockWalletAddress);

            expect(result.netAPY).toBe(6.67);
        });

        it('should return net APR 0 when there are no lend positions', async () => {
            tokenRepositoryMock.find.mockResolvedValue(mockTokens as any);
            priceServiceMock.getPrices.mockReturnValue({});

            portfolioRepositoryMock.getUserTotalBalances.mockResolvedValue([]);
            portfolioRepositoryMock.getUserLendPositionsForApr.mockResolvedValue([]);
            portfolioRepositoryMock.getUserSuppliedAssets.mockResolvedValue([]);
            portfolioRepositoryMock.getUserBorrowedAssets.mockResolvedValue([]);

            const result = await service.getMyPortfolio(mockWalletAddress);

            expect(result.netAPY).toBe(0);
        });

        it('should skip positions with zero amount when computing net APY', async () => {
            tokenRepositoryMock.find.mockResolvedValue(mockTokens as any);
            priceServiceMock.getPrices.mockReturnValue({});

            portfolioRepositoryMock.getUserTotalBalances.mockResolvedValue([]);
            // One valid position (APR = 0.1 → APY = 10%) and one with amountHuman = 0 (should be skipped)
            portfolioRepositoryMock.getUserLendPositionsForApr.mockResolvedValue([
                { asset_id: 'token-uuid-003', shares: '1100000000', amount: '1000000000', created_at: new Date() },
                { asset_id: 'token-uuid-003', shares: '0', amount: '0', created_at: new Date() },
            ]);
            portfolioRepositoryMock.getUserSuppliedAssets.mockResolvedValue([]);
            portfolioRepositoryMock.getUserBorrowedAssets.mockResolvedValue([]);

            const result = await service.getMyPortfolio(mockWalletAddress);

            expect(result.netAPY).toBe(10);
        });

        it('should skip positions with missing decimals', async () => {
            const tokensWithMissingDecimals = [
                ...mockTokens,
                { id: 'token-no-decimals', symbol: 'NODEC', name: 'No Decimals Token', tokenAddress: '0xNODEC', averageLTV: 0, decimals: null },
            ];
            tokenRepositoryMock.find.mockResolvedValue(tokensWithMissingDecimals as any);
            priceServiceMock.getPrices.mockReturnValue({});

            portfolioRepositoryMock.getUserTotalBalances.mockResolvedValue([]);
            portfolioRepositoryMock.getUserLendPositionsForApr.mockResolvedValue([
                { asset_id: 'token-no-decimals', shares: '1100', amount: '1000', created_at: new Date() },
            ]);
            portfolioRepositoryMock.getUserSuppliedAssets.mockResolvedValue([]);
            portfolioRepositoryMock.getUserBorrowedAssets.mockResolvedValue([]);

            const result = await service.getMyPortfolio(mockWalletAddress);

            expect(result.netAPY).toBe(0);
        });

        it('should calculate all time return correctly from lend positions and prices', async () => {
            tokenRepositoryMock.find.mockResolvedValue(mockTokens as any);
            // Price of USDC = 1 USD
            priceServiceMock.getPrices.mockReturnValue({
                'token-uuid-003': 1,
            });

            portfolioRepositoryMock.getUserTotalBalances.mockResolvedValue([]);
            // USDC (6 decimals): amount = 1000 USDC, shares = 1100 USDC → gain = 100 USDC
            portfolioRepositoryMock.getUserLendPositionsForApr.mockResolvedValue([
                { asset_id: 'token-uuid-003', shares: '1100000000', amount: '1000000000', created_at: new Date() },
            ]);
            portfolioRepositoryMock.getUserSuppliedAssets.mockResolvedValue([]);
            portfolioRepositoryMock.getUserBorrowedAssets.mockResolvedValue([]);

            const result = await service.getMyPortfolio(mockWalletAddress);

            expect(result.allTimeReturn).toBe(100);
        });

        it('should handle missing price data gracefully', async () => {
            tokenRepositoryMock.find.mockResolvedValue(mockTokens as any);
            priceServiceMock.getPrices.mockReturnValue({});

            portfolioRepositoryMock.getUserTotalBalances.mockResolvedValue([
                { asset_id: 'token-uuid-001', total_amount: '2' },
            ]);
            portfolioRepositoryMock.getUserLendPositionsForApr.mockResolvedValue([]);
            portfolioRepositoryMock.getUserSuppliedAssets.mockResolvedValue([]);
            portfolioRepositoryMock.getUserBorrowedAssets.mockResolvedValue([]);

            const result = await service.getMyPortfolio(mockWalletAddress);

            expect(result.totalDeposit).toBe(0);
        });

        it('should compute allocation percentages from supplied and borrowed assets', async () => {
            tokenRepositoryMock.find.mockResolvedValue(mockTokens as any);
            priceServiceMock.getPrices.mockReturnValue({
                'token-uuid-001': 3000,
                'token-uuid-002': 50000,
            });

            // Total deposit: 2 ETH -> 6000 USD
            portfolioRepositoryMock.getUserTotalBalances.mockResolvedValue([
                { asset_id: 'token-uuid-001', total_amount: '2' },
            ]);
            portfolioRepositoryMock.getUserLendPositionsForApr.mockResolvedValue([]);

            // Supplied: 1 ETH (base units)
            portfolioRepositoryMock.getUserSuppliedAssets.mockResolvedValue([
                { asset_id: 'token-uuid-001', amount: '1000000000000000000' },
            ]);

            // Borrowed: 0.02 BTC (base units for 8 decimals)
            portfolioRepositoryMock.getUserBorrowedAssets.mockResolvedValue([
                { asset_id: 'token-uuid-002', amount: '2000000' },
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

    describe('getMyAssets', () => {
        it('should return empty result for non-existent account', async () => {
            orderRepositoryMock.findAccountByWallet.mockResolvedValue(null);

            const result = await service.getMyAssets(mockWalletAddress, { page: 1, limit: 10 });

            expect(result.data).toEqual([]);
            expect(result.totalData).toBe(0);
            expect(result.totalPages).toBe(0);
        });

        it('should return paginated user assets with USD amounts', async () => {
            orderRepositoryMock.findAccountByWallet.mockResolvedValue({ id: mockAccountId });

            portfolioRepositoryMock.getUserAssets.mockResolvedValue({
                data: [
                    { asset_id: 'token-uuid-001', amount: '1.5', is_collateral: true },
                    { asset_id: 'token-uuid-002', amount: '0.25', is_collateral: false },
                ],
                total: 2,
            });

            const mockQueryBuilder = {
                select: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                getMany: jest.fn().mockResolvedValue([mockTokens[0], mockTokens[1]]),
            };
            tokenRepositoryMock.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

            priceServiceMock.getPrices.mockReturnValue({
                'token-uuid-001': 3000,
                'token-uuid-002': 50000,
            });

            const result = await service.getMyAssets(mockWalletAddress, { page: 1, limit: 10 });

            expect(result.data).toHaveLength(2);
            expect(result.data[0]).toEqual({
                symbol: 'ETH',
                name: 'Ethereum',
                walletBalance: 1.5,
                amountInUsd: 4500,
                isCollateral: true,
                imageUrl: null,
            });
            expect(result.data[1]).toEqual({
                symbol: 'BTC',
                name: 'Bitcoin',
                walletBalance: 0.25,
                amountInUsd: 12500,
                isCollateral: false,
                imageUrl: null,
            });
            expect(result.totalData).toBe(2);
            expect(result.totalPages).toBe(1);
        });

        it('should handle pagination correctly', async () => {
            orderRepositoryMock.findAccountByWallet.mockResolvedValue({ id: mockAccountId });

            portfolioRepositoryMock.getUserAssets.mockResolvedValue({
                data: [
                    { asset_id: 'token-uuid-001', amount: '1', is_collateral: true },
                ],
                total: 25,
            });

            const mockQueryBuilder = {
                select: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                getMany: jest.fn().mockResolvedValue([mockTokens[0]]),
            };
            tokenRepositoryMock.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);
            const prices = {};
            mockTokens.forEach(t => prices[t.tokenAddress.toLowerCase()] = 3000);
            priceServiceMock.getPrices.mockReturnValue(prices);

            const result = await service.getMyAssets(mockWalletAddress, { page: 2, limit: 10 });

            expect(result.page).toBe(2);
            expect(result.limit).toBe(10);
            expect(result.totalData).toBe(25);
            expect(result.totalPages).toBe(3);
        });

        it('should return 0 USD for missing price data', async () => {
            orderRepositoryMock.findAccountByWallet.mockResolvedValue({ id: mockAccountId });

            portfolioRepositoryMock.getUserAssets.mockResolvedValue({
                data: [{ asset_id: 'token-uuid-001', amount: '1.5', is_collateral: true }],
                total: 1,
            });

            const mockQueryBuilder = {
                select: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                getMany: jest.fn().mockResolvedValue([mockTokens[0]]),
            };
            tokenRepositoryMock.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);
            priceServiceMock.getPrices.mockReturnValue({});

            const result = await service.getMyAssets(mockWalletAddress, { page: 1, limit: 10 });

            expect(result.data[0].amountInUsd).toBe(0);
        });
    });

    describe('getMyPosition', () => {
        it('should throw NotFoundException for non-existent account', async () => {
            orderRepositoryMock.findAccountByWallet.mockResolvedValue(null);

            await expect(service.getMyPosition(mockWalletAddress, { page: 1, limit: 10 }))
                .rejects.toThrow("Account not found");
        });

        it('should return all positions when no type filter is provided', async () => {
            orderRepositoryMock.findAccountByWallet.mockResolvedValue({ id: mockAccountId });

            portfolioRepositoryMock.getUserPositions.mockResolvedValue({
                data: [
                    {
                        order_id: 'order-001',
                        asset_id: 'token-uuid-001',
                        side: OrderSide.Lend,
                        rate: '5.5',
                        quantity: '1000',
                        filled_quantity: '200',
                        status: OrderStatus.Open,
                        symbol: 'ETH',
                        name: 'Ethereum',
                        token_address: '0xETH',
                    },
                    {
                        order_id: 'order-002',
                        asset_id: 'token-uuid-002',
                        side: OrderSide.Borrow,
                        rate: '8.0',
                        quantity: '500',
                        filled_quantity: '100',
                        status: OrderStatus.PartiallyFilled,
                        symbol: 'BTC',
                        name: 'Bitcoin',
                        token_address: '0xBTC',
                    },
                ],
                total: 2,
            });

            const mockQueryBuilder = {
                select: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                getMany: jest.fn().mockResolvedValue([mockTokens[0], mockTokens[1]]),
            };
            tokenRepositoryMock.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

            priceServiceMock.getPrices.mockReturnValue({
                '0xeth': 3000,
                '0xbtc': 50000,
            });

            const result = await service.getMyPosition(mockWalletAddress, { page: 1, limit: 10 });

            expect(result.data).toHaveLength(2);
            expect(result.totalData).toBe(2);
        });

        it('should filter by LEND positions when type is LEND', async () => {
            orderRepositoryMock.findAccountByWallet.mockResolvedValue({ id: mockAccountId });

            portfolioRepositoryMock.getUserPositions.mockResolvedValue({
                data: [
                    {
                        order_id: 'order-001',
                        asset_id: 'token-uuid-001',
                        side: OrderSide.Lend,
                        rate: '5.5',
                        quantity: '1000',
                        filled_quantity: '200',
                        status: OrderStatus.Open,
                        symbol: 'ETH',
                        name: 'Ethereum',
                        token_address: '0xETH',
                    },
                ],
                total: 1,
            });

            const mockQueryBuilder = {
                select: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                getMany: jest.fn().mockResolvedValue([mockTokens[0]]),
            };
            tokenRepositoryMock.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);
            priceServiceMock.getPrices.mockReturnValue({ '0xeth': 3000 });

            const result = await service.getMyPosition(mockWalletAddress, { page: 1, limit: 10, type: 'LEND' });

            expect(portfolioRepositoryMock.getUserPositions).toHaveBeenCalledWith(
                mockAccountId,
                'LEND',
                1,
                10
            );
            expect(result.data).toHaveLength(1);
        });

        it('should filter by BORROW positions when type is BORROW', async () => {
            orderRepositoryMock.findAccountByWallet.mockResolvedValue({ id: mockAccountId });

            portfolioRepositoryMock.getUserPositions.mockResolvedValue({
                data: [
                    {
                        order_id: 'order-002',
                        asset_id: 'token-uuid-002',
                        side: OrderSide.Borrow,
                        rate: '8.0',
                        quantity: '500',
                        filled_quantity: '100',
                        status: OrderStatus.PartiallyFilled,
                        symbol: 'BTC',
                        name: 'Bitcoin',
                        token_address: '0xBTC',
                    },
                ],
                total: 1,
            });

            const mockQueryBuilder = {
                select: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                getMany: jest.fn().mockResolvedValue([mockTokens[1]]),
            };
            tokenRepositoryMock.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);
            priceServiceMock.getPrices.mockReturnValue({ '0xbtc': 50000 });

            const result = await service.getMyPosition(mockWalletAddress, { page: 1, limit: 10, type: 'BORROW' });

            expect(portfolioRepositoryMock.getUserPositions).toHaveBeenCalledWith(
                mockAccountId,
                'BORROW',
                1,
                10
            );
            expect(result.data).toHaveLength(1);
        });

        it('should return position quantity as walletBalance', async () => {
            orderRepositoryMock.findAccountByWallet.mockResolvedValue({ id: mockAccountId });

            portfolioRepositoryMock.getUserPositions.mockResolvedValue({
                data: [
                    {
                        order_id: 'order-001',
                        asset_id: 'token-uuid-001',
                        side: OrderSide.Lend,
                        rate: '5.5',
                        quantity: '1000',
                        filled_quantity: '300',
                        status: OrderStatus.PartiallyFilled,
                        symbol: 'ETH',
                        name: 'Ethereum',
                        token_address: '0xETH',
                    },
                ],
                total: 1,
            });

            const mockQueryBuilder = {
                select: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                getMany: jest.fn().mockResolvedValue([mockTokens[0]]),
            };
            tokenRepositoryMock.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);
            priceServiceMock.getPrices.mockReturnValue({ 'token-uuid-001': 3000 });

            const result = await service.getMyPosition(mockWalletAddress, { page: 1, limit: 10 });

            expect(result.data[0].walletBalance).toBe(1000);
        });

        it('should calculate USD amount correctly for positions', async () => {
            orderRepositoryMock.findAccountByWallet.mockResolvedValue({ id: mockAccountId });

            portfolioRepositoryMock.getUserPositions.mockResolvedValue({
                data: [
                    {
                        order_id: 'order-001',
                        asset_id: 'token-uuid-001',
                        side: OrderSide.Lend,
                        rate: '5.5',
                        quantity: '2',
                        filled_quantity: '0.5',
                        status: OrderStatus.PartiallyFilled,
                        symbol: 'ETH',
                        name: 'Ethereum',
                        token_address: '0xETH',
                    },
                ],
                total: 1,
            });

            const mockQueryBuilder = {
                select: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                getMany: jest.fn().mockResolvedValue([mockTokens[0]]),
            };
            tokenRepositoryMock.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);
            priceServiceMock.getPrices.mockReturnValue({ 'token-uuid-001': 3000 });

            const result = await service.getMyPosition(mockWalletAddress, { page: 1, limit: 10 });

            // quantity = 2, price = 3000 → USD = 6000
            expect(result.data[0].amountInUsd).toBe(6000);
        });

        it('should handle missing price data for positions', async () => {
            orderRepositoryMock.findAccountByWallet.mockResolvedValue({ id: mockAccountId });

            portfolioRepositoryMock.getUserPositions.mockResolvedValue({
                data: [
                    {
                        order_id: 'order-001',
                        asset_id: 'token-uuid-001',
                        side: OrderSide.Lend,
                        rate: '5.5',
                        quantity: '1000',
                        filled_quantity: '200',
                        status: OrderStatus.Open,
                        symbol: 'ETH',
                        name: 'Ethereum',
                        token_address: '0xETH',
                    },
                ],
                total: 1,
            });

            const mockQueryBuilder = {
                select: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                getMany: jest.fn().mockResolvedValue([mockTokens[0]]),
            };
            tokenRepositoryMock.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);
            priceServiceMock.getPrices.mockReturnValue({});

            const result = await service.getMyPosition(mockWalletAddress, { page: 1, limit: 10 });

            expect(result.data[0].amountInUsd).toBe(0);
        });

        it('should return isCollateral as false for positions', async () => {
            orderRepositoryMock.findAccountByWallet.mockResolvedValue({ id: mockAccountId });

            portfolioRepositoryMock.getUserPositions.mockResolvedValue({
                data: [
                    {
                        order_id: 'order-001',
                        asset_id: 'token-uuid-001',
                        side: OrderSide.Lend,
                        rate: '5.5',
                        quantity: '1000',
                        filled_quantity: '200',
                        status: OrderStatus.Open,
                        symbol: 'ETH',
                        name: 'Ethereum',
                        token_address: '0xETH',
                    },
                ],
                total: 1,
            });

            const mockQueryBuilder = {
                select: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                getMany: jest.fn().mockResolvedValue([mockTokens[0]]),
            };
            tokenRepositoryMock.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);
            priceServiceMock.getPrices.mockReturnValue({ '0xeth': 3000 });

            const result = await service.getMyPosition(mockWalletAddress, { page: 1, limit: 10 });

            expect(result.data[0].isCollateral).toBe(false);
        });
        describe('getLendBorrowAssets', () => {
            it('should return supplied lend assets USD, debt USD and health factor', async () => {
                orderRepositoryMock.findAccountByWallet.mockResolvedValue({ id: mockAccountId });
                const tokensWithDecimals = mockTokens.map((t) => ({
                    ...t,
                    decimals: t.id === 'token-uuid-001' ? 18 : t.id === 'token-uuid-002' ? 8 : 6,
                    averageLTV: 7500, // 75% in basis points
                }));
                tokenRepositoryMock.find.mockResolvedValue(tokensWithDecimals as any);
                priceServiceMock.getPrices.mockReturnValue({
                    'token-uuid-001': 3000,
                    'token-uuid-002': 50000,
                    'token-uuid-003': 1,
                });

                // Collateral (used for health factor calculation only)
                portfolioRepositoryMock.getUserCollateralAssets.mockResolvedValue([
                    { asset_id: 'token-uuid-001', amount: '2000000000000000000' },
                ]);
                // Supplied lend assets (used for suppliedAssets field)
                portfolioRepositoryMock.getUserSuppliedAssets.mockResolvedValue([
                    { asset_id: 'token-uuid-003', amount: '5000000000' }, // 5000 USDC (6 decimals)
                ]);
                // Borrowed
                portfolioRepositoryMock.getUserBorrowedAssets.mockResolvedValue([
                    { asset_id: 'token-uuid-002', amount: '10000000' },
                ]);

                const result = await service.getLendBorrowAssets(mockWalletAddress);

                expect(result.suppliedAssets).toBe(5000); // 5000 USDC * $1
                expect(result.borrowedAssets).toBe(5000);  // 0.1 BTC * $50000
                // HF = ((6000 - 5000) * 0.75) / 5000 = 0.15
                expect(result.healthFactor).toBe(0.15);
            });

            it('should handle zero borrowed amount correctly', async () => {
                orderRepositoryMock.findAccountByWallet.mockResolvedValue({ id: mockAccountId });
                const tokensWithDecimals = mockTokens.map((t) => ({
                    ...t,
                    decimals: 18,
                    averageLTV: 7500,
                }));
                tokenRepositoryMock.find.mockResolvedValue(tokensWithDecimals as any);
                priceServiceMock.getPrices.mockReturnValue({ 'token-uuid-001': 3000 });

                portfolioRepositoryMock.getUserCollateralAssets.mockResolvedValue([
                    { asset_id: 'token-uuid-001', amount: '1000000000000000000' },
                ]);
                // Supplied lend assets: 1 ETH
                portfolioRepositoryMock.getUserSuppliedAssets.mockResolvedValue([
                    { asset_id: 'token-uuid-001', amount: '1000000000000000000' },
                ]);
                portfolioRepositoryMock.getUserBorrowedAssets.mockResolvedValue([]);

                const result = await service.getLendBorrowAssets(mockWalletAddress);

                expect(result.suppliedAssets).toBe(3000); // 1 ETH * $3000
                expect(result.borrowedAssets).toBe(0);
                expect(result.healthFactor).toBe(0); // no debt -> formatted as 0 in response
            });

            it('should throw NotFoundException for non-existent account', async () => {
                orderRepositoryMock.findAccountByWallet.mockResolvedValue(null);

                await expect(service.getLendBorrowAssets(mockWalletAddress))
                    .rejects.toThrow("Account not found");
            });
        });

        describe('getMyHealthFactor', () => {
            it('should return formatted health factor for account', async () => {
                orderRepositoryMock.findAccountByWallet.mockResolvedValue({ id: mockAccountId });
                const tokensWithDecimals = mockTokens.map((t) => ({
                    ...t,
                    decimals: 18,
                    averageLTV: 7500,
                }));
                tokenRepositoryMock.find.mockResolvedValue(tokensWithDecimals as any);
                priceServiceMock.getPrices.mockReturnValue({ 'token-uuid-001': 3000 });

                portfolioRepositoryMock.getUserCollateralAssets.mockResolvedValue([
                    { asset_id: 'token-uuid-001', amount: '1000000000000000000' },
                ]);
                portfolioRepositoryMock.getUserBorrowedAssets.mockResolvedValue([]);

                const result = await service.getMyHealthFactor(mockWalletAddress);

                expect(result.collateralUsd).toBe(3000);
                expect(result.debtUsd).toBe(0);
                expect(result.weightedLtv).toBe(0.75);
                expect(result.healthFactor).toBe(Number.POSITIVE_INFINITY);
            });
        });
    });
});
