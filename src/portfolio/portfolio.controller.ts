import { Controller, Get, Query, UseGuards, Body, Put } from "@nestjs/common";
import { PortfolioService } from "./portfolio.service";
import { TransactionHistoryQueryDto } from "./dto/transaction-history.dto";
import {
    GetMyAssetsQueryDto,
    MyAssetsResponseDto,
    MyPortfolioResponseDto,
    LendBorrowAssetResponseDto,
    GetMyPositionResponseDto,
    MyPositionQueryDto,
    SetAssetAsCollateralDto,
    MyHealthFactorResponseDto,
} from "./dto/portfolio.dto";
import { AuthGuard } from "../common/guards/auth.guard";
import { Wallet } from "../common/decorators/wallet.decorator";

@Controller("portfolio")
@UseGuards(AuthGuard)
export class PortfolioController {
    constructor(private readonly portfolioService: PortfolioService) { }

    @Get("my-portfolio")
    async getMyPortfolio(@Wallet() wallet: string): Promise<MyPortfolioResponseDto> {
        return this.portfolioService.getMyPortfolio(wallet);
    }

    @Get("my-assets")
    async getMyAssets(
        @Wallet() wallet: string,
        @Query() query: GetMyAssetsQueryDto,
    ): Promise<MyAssetsResponseDto> {
        return this.portfolioService.getMyAssets(wallet, query);
    }

    @Get("lend-borrow-assets")
    async getLendAndBorrowAssets(@Wallet() wallet: string): Promise<LendBorrowAssetResponseDto> {
        return this.portfolioService.getLendBorrowAssets(wallet);
    }

    @Get("my-health-factor")
    async getMyHealthFactor(@Wallet() wallet: string): Promise<MyHealthFactorResponseDto> {
        return this.portfolioService.getMyHealthFactor(wallet);
    }

    @Get("my-position")
    async getMyPosition(
        @Wallet() wallet: string,
        @Query() query: MyPositionQueryDto,
    ): Promise<GetMyPositionResponseDto> {
        return this.portfolioService.getMyPosition(wallet, query);
    }

    @Put("is-collateral")
    async setAssetAsCollateral(
        @Wallet() wallet: string,
        @Body() body: SetAssetAsCollateralDto,
    ): Promise<void> {
        return this.portfolioService.setAssetAsCollateral(wallet, body);
    }

    @Get("transaction-history")
    async getTransactionHistory(
        @Wallet() wallet: string,
        @Query() query: TransactionHistoryQueryDto,
    ) {
        return this.portfolioService.getTransactionHistory(wallet, query);
    }
}
