import { Test, TestingModule } from '@nestjs/testing';
import { MarketController } from '../../market/market.controller';
import { MarketService } from '../../market/market.service';
import { NotFoundException } from '@nestjs/common';

describe('MarketController', () => {
    let controller: MarketController;
    let service: MarketService;

    const mockMarketDetail = {
        asset: {
            id: 'asset-uuid',
            name: 'Bitcoin',
            symbol: 'BTC',
            decimals: 8,
            imageUrl: 'http://image.url',
        },
        market: {
            market_id: 'market-uuid-1',
            maturity: 1711929600, // 1 Apr
        },
        borrow_rate: 5.5,
        lend_rate: 4.2,
        collateral_factor: 75,
        total_deposit: 100000.00,
        active_loans: 50000.00,
        upcoming_maturities: [
            { market_id: 'market-uuid-1', maturity: 1711929600 },
            { market_id: 'market-uuid-2', maturity: 1714521600 },
            { market_id: 'market-uuid-3', maturity: 1717200000 },
        ],
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [MarketController],
            providers: [
                {
                    provide: MarketService,
                    useValue: {
                        getMarketSnapshot: jest.fn(),
                        getMarketDetail: jest.fn(),
                    },
                },
            ],
        }).compile();

        controller = module.get<MarketController>(MarketController);
        service = module.get<MarketService>(MarketService);
    });

    it('should return market detail when found', async () => {
        const assetId = '550e8400-e29b-41d4-a716-446655440000';
        jest.spyOn(service, 'getMarketDetail').mockResolvedValue(mockMarketDetail as any);

        const result = await controller.getMarketDetail(assetId);

        expect(result).toEqual(mockMarketDetail);
        expect(service.getMarketDetail).toHaveBeenCalledWith(assetId);
    });

    it('should throw NotFoundException when asset is not found', async () => {
        const assetId = '550e8400-e29b-41d4-a716-446655440001';
        jest.spyOn(service, 'getMarketDetail').mockRejectedValue(new NotFoundException());

        await expect(controller.getMarketDetail(assetId)).rejects.toThrow(NotFoundException);
    });
});
