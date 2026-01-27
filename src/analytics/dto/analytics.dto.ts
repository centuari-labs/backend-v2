import { IsOptional, IsUUID } from "class-validator";

export class GetAnalyticsQueryDto {
    @IsOptional()
    @IsUUID()
    accountId?: string;
}

export class TotalBalancePortfolioDto {
    totalSupply: string;
    totalBorrow: string;
    netBalance: string;
    supplyPositions: SupplyPositionSummary[];
    borrowPositions: BorrowPositionSummary[];
}

export class SupplyPositionSummary {
    assetId: string;
    marketId: string;
    amount: string;
    shares: string;
}

export class BorrowPositionSummary {
    assetId: string;
    marketId: string;
    debt: string;
    shares: string;
}

export class MyAssetDto {
    assetId: string;
    amount: string;
    isCollateral: boolean;
}

export class MyPositionDto {
    lendPositions: LendPositionDto[];
    borrowPositions: BorrowPositionDto[];
}

export class LendPositionDto {
    id: string;
    assetId: string;
    marketId: string;
    shares: string;
    amount: string;
    createdAt: Date;
}

export class BorrowPositionDto {
    id: string;
    assetId: string;
    marketId: string;
    shares: string;
    debt: string;
    createdAt: Date;
}
