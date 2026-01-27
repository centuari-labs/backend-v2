import { Controller, Get, Post, Query, Body, ValidationPipe, UseGuards } from '@nestjs/common';
import { MarketService } from './market.service';
import { CreateMarketDto, GetMarketsQueryDto, MarketResponseDto, BorrowRateDto, NetAPRDto, ActiveLoanDto, TotalDepositDto, CollateralFactorDto } from './dto/market.dto';
import { PrivyGuard } from '../core/privy/privy.guard';
import { Wallet } from '../common/decorators/wallet.decorator';

@Controller('market')
export class MarketController {
    constructor(private readonly marketService: MarketService) { }

    @Get()
    async getMarkets(
        @Query(new ValidationPipe({ transform: true })) query: GetMarketsQueryDto
    ): Promise<MarketResponseDto[]> {
        return this.marketService.getMarkets(query.assetId);
    }

    @Post()
    async createMarket(
        @Body(new ValidationPipe({ transform: true })) dto: CreateMarketDto
    ): Promise<MarketResponseDto> {
        return this.marketService.createMarket(dto);
    }

    @Get('borrow-rate')
    async getBorrowRate(
        @Query(new ValidationPipe({ transform: true })) query: GetMarketsQueryDto
    ): Promise<BorrowRateDto> {
        return this.marketService.getBorrowRate(query.assetId);
    }

    @Get('net-apr')
    async getNetAPR(
        @Query(new ValidationPipe({ transform: true })) query: GetMarketsQueryDto
    ): Promise<NetAPRDto> {
        return this.marketService.getNetAPR(query.assetId);
    }

    @Get('active-loans')
    @UseGuards(PrivyGuard)
    async getActiveLoans(
        @Wallet() wallet: string
    ): Promise<ActiveLoanDto[]> {
        return this.marketService.getActiveLoans(wallet);
    }

    @Get('total-deposit')
    @UseGuards(PrivyGuard)
    async getTotalDeposit(
        @Wallet() wallet: string
    ): Promise<TotalDepositDto> {
        return this.marketService.getTotalDeposit(wallet);
    }

    @Get('collateral-factor')
    async getCollateralFactor(): Promise<CollateralFactorDto> {
        return this.marketService.getCollateralFactor();
    }
}
