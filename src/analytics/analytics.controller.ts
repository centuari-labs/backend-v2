import { Controller, Get, UseGuards } from "@nestjs/common";
import { AnalyticsService } from "./analytics.service";
import {
    TotalBalancePortfolioDto,
    MyAssetDto,
    MyPositionDto,
} from "./dto/analytics.dto";
import { PrivyGuard } from "../core/privy/privy.guard";
import { Wallet } from "../common/decorators/wallet.decorator";

@Controller("analytics")
@UseGuards(PrivyGuard)
export class AnalyticsController {
    constructor(private readonly analyticsService: AnalyticsService) { }

    @Get("total-balance")
    async getTotalBalance(
        @Wallet() wallet: string,
    ): Promise<TotalBalancePortfolioDto> {
        return this.analyticsService.getTotalBalancePortfolio(wallet);
    }

    @Get("my-assets")
    async getMyAssets(@Wallet() wallet: string): Promise<MyAssetDto[]> {
        return this.analyticsService.getMyAssets(wallet);
    }

    @Get("positions")
    async getPositions(@Wallet() wallet: string): Promise<MyPositionDto> {
        return this.analyticsService.getAllMyPositions(wallet);
    }
}
