import { Controller, Get, Param, ParseUUIDPipe } from "@nestjs/common";
import { MarketService } from "./market.service";
import { MarketDetailResponseDto, MarketResponseDto } from "./dto/market.dto";
import { RateHistoryDataDto } from "./dto/rate-history.dto";

@Controller("market")
export class MarketController {
    constructor(private readonly marketService: MarketService) {}

    @Get()
    async getMarket(): Promise<MarketResponseDto> {
        return this.marketService.getMarketSnapshot();
    }

    @Get(":assetId")
    async getMarketDetail(
        @Param("assetId", ParseUUIDPipe) assetId: string,
    ): Promise<MarketDetailResponseDto> {
        return this.marketService.getMarketDetail(assetId);
    }

    @Get(":assetId/rate-history")
    async getRateHistory(
        @Param("assetId", ParseUUIDPipe) assetId: string,
    ): Promise<RateHistoryDataDto> {
        return this.marketService.getRateHistory(assetId);
    }
}
