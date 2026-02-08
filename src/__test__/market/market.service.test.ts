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
        const mockRawRates = [
            // Asset 1: Has both borrow and lend orders
            { assetId: 'asset1', highestBid: '0.05', lowestAsk: '0.08' },
            // Asset 2: Only has borrow orders (bids) -> lend_rate exists, borrow_rate should be 0/null
            { assetId: 'asset2', highestBid: '0.04', lowestAsk: null },
        ];

        orderRepositoryMock.getBestRates.mockResolvedValue(mockRawRates);

        const result = await service.getMarketSnapshot();

        const btcMarket = result.markets.find(m => m.asset.symbol === 'BTC');
        const ethMarket = result.markets.find(m => m.asset.symbol === 'ETH');

        // lend_rate = highest bid (highest borrow order rate)
        // borrow_rate = lowest ask (lowest lend order rate)

        expect(btcMarket).toBeDefined();
        // Asset 1
        expect(btcMarket?.lend_rate).toBe(0.05); // highestBid
        expect(btcMarket?.borrow_rate).toBe(0.08); // lowestAsk

        expect(ethMarket).toBeDefined();
        // Asset 2
        expect(ethMarket?.lend_rate).toBe(0.04); // highestBid
        expect(ethMarket?.borrow_rate).toBe(0); // lowestAsk is null, should default to 0
    });
});
