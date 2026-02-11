import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PortfolioService } from '../../portfolio/portfolio.service';
import { Token } from '../../tokens/entities/token.entity';
import { PriceService } from '../../price/price.service';
import { PortfolioRepository } from '../../portfolio/repositories/portfolio.repository';
import { OrderRepository } from '../../orders/repositories/order.repository';
import { OrderSide, OrderStatus } from '../../orders/constants/order.constants';

describe('PortfolioService', () => {
    let service: PortfolioService;
    let tokenRepositoryMock: jest.Mocked<Repository<Token>>;
    let priceServiceMock: jest.Mocked<PriceService>;
    let portfolioRepositoryMock: any;
    let orderRepositoryMock: any;

    const mockWalletAddress = '0x1234567890abcdef1234567890abcdef12345678';
    const mockAccountId = 'account-uuid-001';

    const mockTokens = [
        { id: 'token-uuid-001', symbol: 'ETH', name: 'Ethereum', tokenAddress: '0xETH', averageLTV: 0.75 },
        { id: 'token-uuid-002', symbol: 'BTC', name: 'Bitcoin', tokenAddress: '0xBTC', averageLTV: 0.70 },
        { id: 'token-uuid-003', symbol: 'USDC', name: 'USD Coin', tokenAddress: '0xUSDC', averageLTV: 0.85 },
    ];

    beforeEach(async () => {
        tokenRepositoryMock = {
            find: jest.fn(),
            createQueryBuilder: jest.fn(),
        } as any;

        priceServiceMock = {
            getPrice: jest.fn(),
        } as any;

        portfolioRepositoryMock = {
            getUserTotalBalances: jest.fn(),
            getUserNetAPY: jest.fn(),
            getUserSuppliedAssets: jest.fn(),
            getUserBorrowedAssets: jest.fn(),
            getUserAssets: jest.fn(),
            getUserPositions: jest.fn(),
            getCollateralAssets: jest.fn(),
        };

        orderRepositoryMock = {
            findAccountByWallet: jest.fn().mockResolvedValue({ id: mockAccountId }),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PortfolioService,
                { provide: getRepositoryToken(Token), useValue: tokenRepositoryMock },
                { provide: PriceService, useValue: priceServiceMock },
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
            priceServiceMock.getPrice.mockImplementation(async (tokenAddress: string) => {
                if (tokenAddress === '0xETH') return 3000;
                if (tokenAddress === '0xBTC') return 50000;
                if (tokenAddress === '0xUSDC') return 1;
                return null;
            });

            portfolioRepositoryMock.getUserTotalBalances.mockResolvedValue([
                { asset_id: 'token-uuid-001', total_amount: '2' }, // 2 ETH
                { asset_id: 'token-uuid-002', total_amount: '0.5' }, // 0.5 BTC
            ]);
            portfolioRepositoryMock.getUserNetAPY.mockResolvedValue([]);

            const result = await service.getMyPortfolio(mockWalletAddress);

            // (2 * 3000) + (0.5 * 50000) = 6000 + 25000 = 31000
            expect(result.totalDeposit).toBe(31000.00);
        });

        it('should calculate net APY correctly', async () => {
            tokenRepositoryMock.find.mockResolvedValue(mockTokens as any);
            priceServiceMock.getPrice.mockResolvedValue(1000);

            portfolioRepositoryMock.getUserTotalBalances.mockResolvedValue([]);
            portfolioRepositoryMock.getUserNetAPY.mockResolvedValue([
                { asset_id: 'token-uuid-001', net_apy: '5.50' },
                { asset_id: 'token-uuid-002', net_apy: '3.25' },
            ]);

            const result = await service.getMyPortfolio(mockWalletAddress);

            expect(result.netAPY).toBe(4.38);
        });

        it('should calculate all time return correctly', async () => {
            tokenRepositoryMock.find.mockResolvedValue(mockTokens as any);
            priceServiceMock.getPrice.mockResolvedValue(1000);

            portfolioRepositoryMock.getUserTotalBalances.mockResolvedValue([]);
            portfolioRepositoryMock.getUserNetAPY.mockResolvedValue([]);

            const result = await service.getMyPortfolio(mockWalletAddress);

            expect(result.allTimeReturn).toBe(0);
        });

        it('should handle missing price data gracefully', async () => {
            tokenRepositoryMock.find.mockResolvedValue(mockTokens as any);
            priceServiceMock.getPrice.mockResolvedValue(null);

            portfolioRepositoryMock.getUserTotalBalances.mockResolvedValue([
                { asset_id: 'token-uuid-001', total_amount: '2' },
            ]);
            portfolioRepositoryMock.getUserNetAPY.mockResolvedValue([]);

            const result = await service.getMyPortfolio(mockWalletAddress);

            expect(result.totalDeposit).toBe(0);
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

            priceServiceMock.getPrice.mockImplementation(async (tokenAddress: string) => {
                if (tokenAddress === '0xETH') return 3000;
                if (tokenAddress === '0xBTC') return 50000;
                return null;
            });

            const result = await service.getMyAssets(mockWalletAddress, { page: 1, limit: 10 });

            expect(result.data).toHaveLength(2);
            expect(result.data[0]).toEqual({
                symbol: 'ETH',
                name: 'Ethereum',
                walletBalance: '1.5',
                amountInUsd: '4500.00',
                isCollateral: true,
            });
            expect(result.data[1]).toEqual({
                symbol: 'BTC',
                name: 'Bitcoin',
                walletBalance: '0.25',
                amountInUsd: '12500.00',
                isCollateral: false,
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
            priceServiceMock.getPrice.mockResolvedValue(3000);

            const result = await service.getMyAssets(mockWalletAddress, { page: 2, limit: 10 });

            expect(result.page).toBe(2);
            expect(result.limit).toBe(10);
            expect(result.totalData).toBe(25);
            expect(result.totalPages).toBe(3);
        });

        it('should return 0.00 USD for missing price data', async () => {
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
            priceServiceMock.getPrice.mockResolvedValue(null);

            const result = await service.getMyAssets(mockWalletAddress, { page: 1, limit: 10 });

            expect(result.data[0].amountInUsd).toBe('0.00');
        });
    });

    describe('getMyPosition', () => {
        it('should return empty result for non-existent account', async () => {
            orderRepositoryMock.findAccountByWallet.mockResolvedValue(null);

            const result = await service.getMyPosition(mockWalletAddress, { page: 1, limit: 10 });

            expect(result.data).toEqual([]);
            expect(result.totalData).toBe(0);
            expect(result.totalPages).toBe(0);
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

            priceServiceMock.getPrice.mockImplementation(async (tokenAddress: string) => {
                if (tokenAddress === '0xETH') return 3000;
                if (tokenAddress === '0xBTC') return 50000;
                return null;
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
            priceServiceMock.getPrice.mockResolvedValue(3000);

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
            priceServiceMock.getPrice.mockResolvedValue(50000);

            const result = await service.getMyPosition(mockWalletAddress, { page: 1, limit: 10, type: 'BORROW' });

            expect(portfolioRepositoryMock.getUserPositions).toHaveBeenCalledWith(
                mockAccountId,
                'BORROW',
                1,
                10
            );
            expect(result.data).toHaveLength(1);
        });

        it('should calculate remaining quantity correctly', async () => {
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
            priceServiceMock.getPrice.mockResolvedValue(3000);

            const result = await service.getMyPosition(mockWalletAddress, { page: 1, limit: 10 });

            // Remaining: 1000 - 300 = 700
            expect(result.data[0].walletBalance).toBe('700');
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
            priceServiceMock.getPrice.mockResolvedValue(3000);

            const result = await service.getMyPosition(mockWalletAddress, { page: 1, limit: 10 });

            // Remaining: 2 - 0.5 = 1.5 ETH
            // USD: 1.5 * 3000 = 4500
            expect(result.data[0].amountInUsd).toBe('4500.00');
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
            priceServiceMock.getPrice.mockResolvedValue(null);

            const result = await service.getMyPosition(mockWalletAddress, { page: 1, limit: 10 });

            expect(result.data[0].amountInUsd).toBe('0.00');
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
            priceServiceMock.getPrice.mockResolvedValue(3000);

            const result = await service.getMyPosition(mockWalletAddress, { page: 1, limit: 10 });

            expect(result.data[0].isCollateral).toBe(false);
        });
        describe('getLendBorrowAssets', () => {
            it('should return aggregated USD values and formatted health factor', async () => {
                orderRepositoryMock.findAccountByWallet.mockResolvedValue({ id: mockAccountId });
                tokenRepositoryMock.find.mockResolvedValue(mockTokens as any);
                priceServiceMock.getPrice.mockImplementation(async (tokenAddress: string) => {
                    if (tokenAddress === '0xETH') return 3000;
                    if (tokenAddress === '0xBTC') return 50000;
                    return null;
                });

                portfolioRepositoryMock.getUserSuppliedAssets.mockResolvedValue([
                    { asset_id: 'token-uuid-001', amount: '2' }, // 2 ETH = 6000 USD
                ]);
                portfolioRepositoryMock.getUserBorrowedAssets.mockResolvedValue([
                    { asset_id: 'token-uuid-002', amount: '0.1' }, // 0.1 BTC = 5000 USD
                ]);

                const result = await service.getLendBorrowAssets(mockWalletAddress);

                expect(result.suppliedAssets).toBe(6000);
                expect(result.borrowedAssets).toBe(5000);
                // HF = 6000 / 5000 = 1.2
                expect(result.healthFactor).toBe(1.2);
            });

            it('should handle zero borrowed amount correctly', async () => {
                orderRepositoryMock.findAccountByWallet.mockResolvedValue({ id: mockAccountId });
                tokenRepositoryMock.find.mockResolvedValue(mockTokens as any);
                priceServiceMock.getPrice.mockResolvedValue(3000);

                portfolioRepositoryMock.getUserSuppliedAssets.mockResolvedValue([
                    { asset_id: 'token-uuid-001', amount: '1' },
                ]);
                portfolioRepositoryMock.getUserBorrowedAssets.mockResolvedValue([]);

                const result = await service.getLendBorrowAssets(mockWalletAddress);

                expect(result.suppliedAssets).toBe(3000);
                expect(result.borrowedAssets).toBe(0);
                expect(result.healthFactor).toBe(0);
            });

            it('should handle non-existent account gracefully', async () => {
                orderRepositoryMock.findAccountByWallet.mockResolvedValue(null);

                const result = await service.getLendBorrowAssets(mockWalletAddress);

                expect(result.suppliedAssets).toBe(0);
                expect(result.borrowedAssets).toBe(0);
                expect(result.healthFactor).toBe(0);
            });
        });
    });
});
