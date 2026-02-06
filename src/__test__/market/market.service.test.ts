import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MarketService } from '../../market/market.service';
import { Order } from '../../orders/entities/order.entity';
import { Token } from '../../tokens/entities/token.entity';
import { PRICE_PROVIDER } from '../../market/price-provider.interface';

describe('MarketService', () => {
    let service: MarketService;
    let module: TestingModule;
    let priceProvider: any;

    beforeEach(async () => {
        const mockOrderRepository = {
            createQueryBuilder: jest.fn(),
            find: jest.fn(),
        };

        const mockTokenRepository = {
            find: jest.fn(),
        };

        const mockPriceProvider = {
            getPrices: jest.fn(),
        };

        module = await Test.createTestingModule({
            providers: [
                MarketService,
                {
                    provide: getRepositoryToken(Order),
                    useValue: mockOrderRepository,
                },
                {
                    provide: getRepositoryToken(Token),
                    useValue: mockTokenRepository,
                },
                {
                    provide: PRICE_PROVIDER,
                    useValue: mockPriceProvider,
                },
            ],
        }).compile();

        service = module.get<MarketService>(MarketService);
        priceProvider = module.get(PRICE_PROVIDER);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('getMarketSnapshot', () => {
        it('should return aggregated market data', async () => {
            const mockTokens = [
                { id: '1', name: 'Bitcoin', symbol: 'BTC', averageLTV: 0.75 },
                { id: '2', name: 'Ethereum', symbol: 'ETH', averageLTV: 0.80 },
            ];

            const mockRawRates = [
                { assetId: '1', side: 'BORROW', maxRate: '0.05' },
                { assetId: '1', side: 'LEND', maxRate: '0.03' },
            ];

            const mockOrders = [
                { assetId: '1', quantity: '1', side: 'LEND', status: 'OPEN' }, // 1 BTC = 65000 USD
                { assetId: '2', quantity: '2', side: 'BORROW', status: 'OPEN' }, // 2 ETH = 7000 USD
            ];

            const mockPrices = new Map<string, number | null>([
                ['BTC', 65000],
                ['ETH', 3500],
            ]);

            const mockQueryBuilder = {
                select: jest.fn().mockReturnThis(),
                addSelect: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                groupBy: jest.fn().mockReturnThis(),
                addGroupBy: jest.fn().mockReturnThis(),
                getRawMany: jest.fn().mockResolvedValue(mockRawRates),
            };

            const mockTokenRepository = module.get(getRepositoryToken(Token));
            const mockOrderRepository = module.get(getRepositoryToken(Order));

            mockTokenRepository.find.mockResolvedValue(mockTokens as any);
            mockOrderRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);
            mockOrderRepository.find.mockResolvedValue(mockOrders as any);
            priceProvider.getPrices.mockResolvedValue(mockPrices);

            const result = await service.getMarketSnapshot();

            expect(result.total_deposit).toBe('65000.00');
            expect(result.active_loans).toBe('7000.00');
            expect(result.markets).toHaveLength(2);
            expect(result.markets[0].asset.symbol).toBe('BTC');
            expect(result.markets[0].borrow_rate).toBe(0.05);
        });

        it('should return fallback USDC data when no tokens are found', async () => {
            const mockTokenRepository = module.get(getRepositoryToken(Token));
            const mockOrderRepository = module.get(getRepositoryToken(Order));

            mockTokenRepository.find.mockResolvedValue([]);
            priceProvider.getPrices.mockResolvedValue(new Map());
            mockOrderRepository.find.mockResolvedValue([]);

            const mockQueryBuilder = {
                select: jest.fn().mockReturnThis(),
                addSelect: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                groupBy: jest.fn().mockReturnThis(),
                addGroupBy: jest.fn().mockReturnThis(),
                getRawMany: jest.fn().mockResolvedValue([]),
            };
            mockOrderRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

            const result = await service.getMarketSnapshot();

            expect(result.total_deposit).toBe('0.00');
            expect(result.active_loans).toBe('0.00');
            expect(result.markets).toHaveLength(1);
            expect(result.markets[0].asset.symbol).toBe('USDC');
            expect(result.markets[0].asset.name).toBe('USD Coin');
            expect(result.markets[0].borrow_rate).toBe(0);
            expect(result.markets[0].lend_rate).toBe(550);
            expect(result.markets[0].collateral_factor).toBe(0);
        });
    });
});
