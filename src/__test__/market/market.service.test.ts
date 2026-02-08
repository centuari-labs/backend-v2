import { Test, TestingModule } from '@nestjs/testing';
import { MarketService } from '../../market/market.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { OrderRepository } from '../../orders/repositories/order.repository';
import { Token } from '../../tokens/entities/token.entity';
import { PriceService } from '../../price/price.service';

describe('MarketService', () => {
    let service: MarketService;
    let orderRepositoryMock: any;
    let tokenRepositoryMock: any;
    let priceServiceMock: any;

    const mockAssets = [
        { id: 'asset1', symbol: 'BTC', name: 'Bitcoin', tokenAddress: '0x123', averageLTV: 0.75 },
        { id: 'asset2', symbol: 'ETH', name: 'Ethereum', tokenAddress: '0x456', averageLTV: 0.80 },
    ];

    beforeEach(async () => {
        orderRepositoryMock = {
            getBestRates: jest.fn(),
            find: jest.fn().mockResolvedValue([]),
        };
        tokenRepositoryMock = {
            find: jest.fn().mockResolvedValue(mockAssets),
        };
        priceServiceMock = {
            getPrice: jest.fn().mockResolvedValue(1000),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                MarketService,
                { provide: OrderRepository, useValue: orderRepositoryMock },
                { provide: getRepositoryToken(Token), useValue: tokenRepositoryMock },
                { provide: PriceService, useValue: priceServiceMock },
            ],
        }).compile();

        service = module.get<MarketService>(MarketService);
    });

    it('should correctly map highest borrow rate to lend_rate and lowest lend rate to borrow_rate', async () => {
        const mockRateMap = new Map<string, { borrow: number; lend: number }>();
        mockRateMap.set('asset1', { lend: 0.05, borrow: 0.08 });
        mockRateMap.set('asset2', { lend: 0.04, borrow: 0 });

        orderRepositoryMock.getBestRates.mockResolvedValue(mockRateMap);

        const result = await service.getMarketSnapshot();

        const btcMarket = result.markets.find(m => m.asset.symbol === 'BTC');
        const ethMarket = result.markets.find(m => m.asset.symbol === 'ETH');

        expect(btcMarket).toBeDefined();
        expect(btcMarket?.lend_rate).toBe(0.05);
        expect(btcMarket?.borrow_rate).toBe(0.08);

        expect(ethMarket).toBeDefined();
        expect(ethMarket?.lend_rate).toBe(0.04);
        expect(ethMarket?.borrow_rate).toBe(0);
    });
});
