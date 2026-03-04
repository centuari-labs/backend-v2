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
            market_id: 'market-uuid',
            maturity: 1700000000,
        },
        borrow_rate: 5.5,
        lend_rate: 4.2,
        collateral_factor: 75,
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
        const marketId = '550e8400-e29b-41d4-a716-446655440000';
        jest.spyOn(service, 'getMarketDetail').mockResolvedValue(mockMarketDetail);

        const result = await controller.getMarketDetail(marketId);

        expect(result).toEqual(mockMarketDetail);
        expect(service.getMarketDetail).toHaveBeenCalledWith(marketId);
    });

    it('should throw NotFoundException when market is not found', async () => {
        const marketId = '550e8400-e29b-41d4-a716-446655440001';
        jest.spyOn(service, 'getMarketDetail').mockRejectedValue(new NotFoundException());

        await expect(controller.getMarketDetail(marketId)).rejects.toThrow(NotFoundException);
    });
});
