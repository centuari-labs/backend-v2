import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { MarketService } from './market.service';
import { MarketDetailResponseDto, MarketResponseDto } from './dto/market.dto';

@Controller('market')
export class MarketController {
    constructor(private readonly marketService: MarketService) { }

    @Get()
    async getMarket(): Promise<MarketResponseDto> {
        return this.marketService.getMarketSnapshot();
    }

    @Get(':assetId')
    async getMarketDetail(
        @Param('assetId', ParseUUIDPipe) assetId: string,
    ): Promise<MarketDetailResponseDto> {
        return this.marketService.getMarketDetail(assetId);
    }
}
