import { Controller, Get } from '@nestjs/common';
import { MarketService } from './market.service';
import { MarketResponseDto } from './dto/market.dto';

@Controller('market')
export class MarketController {
    constructor(private readonly marketService: MarketService) { }

    @Get()
    async getMarket(): Promise<MarketResponseDto> {
        return this.marketService.getMarketSnapshot();
    }

    //@todo : market detail endpoint
}
