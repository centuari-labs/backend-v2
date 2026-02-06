import { IsUUID, IsOptional, IsDateString } from 'class-validator';

export class CreateMarketDto {
    @IsUUID()
    assetId: string;
}

export class GetMarketsQueryDto {
    @IsOptional()
    @IsUUID()
    assetId?: string;
}

export class MarketItemDto {
    asset: {
        name: string;
        symbol: string;
    };
    borrow_rate: number;
    lend_rate: number;
    collateral_factor: number;
}

export class MarketResponseDto {
    total_deposit: string;
    active_loans: string;
    markets: MarketItemDto[];
}

export class BorrowRateDto {
    rate: string;
    assetId?: string;
}

export class NetAPRDto {
    rate: string;
    assetId?: string;
}

export class ActiveLoanDto {
    id: string;
    assetId: string;
    marketId: string;
    shares: string;
    debt: string;
    originalDebt: string;
    createdAt: Date;
}

export class TotalDepositDto {
    totalAmount: string;
    totalAmountUSD: string;
    assets: AssetDepositDto[];
}

export class AssetDepositDto {
    assetId: string;
    amount: string;
    isCollateral: boolean;
}

export class CollateralFactorDto {
    averageLLTV: string;
    totalAssets: number;
}
