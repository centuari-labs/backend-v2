import {
    Controller,
    Get,
    Post,
    Query,
    UseGuards,
    Body,
    Put,
} from "@nestjs/common";
import { PortfolioService } from "./portfolio.service";
import { RepayService } from "./repay.service";
import { TransactionHistoryQueryDto } from "./dto/transaction-history.dto";
import { OpenOrdersQueryDto } from "./dto/open-orders.dto";
import {
    GetMyAssetsQueryDto,
    MyAssetsResponseDto,
    MyPortfolioResponseDto,
    GetMyPositionResponseDto,
    MyPositionQueryDto,
    SetAssetAsCollateralDto,
    MyHealthFactorResponseDto,
    UserDetailsResponseDto,
} from "./dto/portfolio.dto";
import { ChartDataQueryDto } from "./dto/chart-data.dto";
import { AuthGuard } from "../common/guards/auth.guard";
import { Wallet, CurrentUser } from "../common/decorators/wallet.decorator";
import { WithdrawLendPositionDto } from "./dto/withdraw-lend-position.dto";
import { RepayRequestDto, type RepayResponseDto } from "./dto/repay.dto";

@Controller("portfolio")
@UseGuards(AuthGuard)
export class PortfolioController {
    constructor(
        private readonly portfolioService: PortfolioService,
        private readonly repayService: RepayService,
    ) {}

    @Get("my-portfolio")
    async getMyPortfolio(
        @Wallet() wallet: string,
    ): Promise<MyPortfolioResponseDto> {
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
    async getLendAndBorrowAssets(
        @Wallet() wallet: string,
        @Query() query: ChartDataQueryDto,
    ) {
        return this.portfolioService.getLendBorrowAssets(
            wallet,
            query.days ?? 90,
        );
    }

    @Get("my-health-factor")
    async getMyHealthFactor(
        @Wallet() wallet: string,
    ): Promise<MyHealthFactorResponseDto> {
        return this.portfolioService.getMyHealthFactor(wallet);
    }

    @Get("my-position")
    async getMyPosition(
        @Wallet() wallet: string,
        @Query() query: MyPositionQueryDto,
    ): Promise<GetMyPositionResponseDto> {
        return this.portfolioService.getMyPosition(wallet, query);
    }

    @Get("user-details")
    async getUserDetails(
        @Wallet() wallet: string,
    ): Promise<UserDetailsResponseDto> {
        return this.portfolioService.getUserDetails(wallet);
    }

    @Put("is-collateral")
    async setAssetAsCollateral(
        @Wallet() wallet: string,
        @Body() body: SetAssetAsCollateralDto,
    ): Promise<void> {
        return this.portfolioService.setAssetAsCollateral(wallet, body);
    }

    //@todo : change to use position id instead of market id
    @Post("withdraw-lend-position")
    async withdrawLendPosition(
        @Body() dto: WithdrawLendPositionDto,
        @Wallet() walletAddress: string,
        @CurrentUser() user: { userId: string },
    ) {
        return this.portfolioService.withdrawLendPosition(
            dto,
            walletAddress,
            user.userId,
        );
    }
  
    @Get("open-orders")
    async getOpenOrders(
        @Wallet() wallet: string,
        @Query() query: OpenOrdersQueryDto,
    ) {
        return this.portfolioService.getOpenOrders(wallet, query);
    }

    @Post("repay")
    async repay(
        @Body() dto: RepayRequestDto,
        @Wallet() walletAddress: string,
        @CurrentUser() user: { userId: string },
    ): Promise<RepayResponseDto> {
        return this.repayService.repay(dto, walletAddress, user.userId);
    }

    @Get("transaction-history")
    async getTransactionHistory(
        @Wallet() wallet: string,
        @Query() query: TransactionHistoryQueryDto,
    ) {
        return this.portfolioService.getTransactionHistory(wallet, query);
    }
}
