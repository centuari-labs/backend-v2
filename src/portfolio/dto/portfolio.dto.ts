import { IsOptional, IsUUID } from "class-validator";

export class TotalBalanceDto {
    totalDeposit: number;
}

export class AllTimeReturnDto {
    allTimeReturn: number;
}

export class NetAPYDto {
    netAPY: number;
}

export class PortfolioAllocationDto {
    availableBalanceUsd: number;
    suppliedAssetsUsd: number;
    borrowedAssetsUsd: number;
    availableBalancePct: number;
    suppliedAssetsPct: number;
    borrowedAssetsPct: number;
}

export class MyPortfolioResponseDto {
    totalDeposit: number;
    allTimeReturn: number;
    netAPY: number;
    allocation: PortfolioAllocationDto;
}

export class healthFactorDto {
    healthFactor: number;
}

export class LendBorrowAssetResponseDto {
    suppliedAssets: number;
    borrowedAssets: number;
    healthFactor: number;
}

export class MyHealthFactorResponseDto {
    collateralUsd: number;
    debtUsd: number;
    weightedLtv: number;
    /** Health factor; may be Infinity when there is no debt. */
    healthFactor: number;
}

export class MyAssetDto {
    assetsId: string;
    amountInUsd: number;
    isCollateral: boolean;
    imageUrl?: string | null;
}

export class GetMyAssetsQueryDto {
    page?: number = 1;

    limit?: number = 10;
}

export class MyAssetItemDto {
    assetId: string;
    symbol: string;
    name: string;
    walletBalance: number;
    amountInUsd: number;
    isCollateral: boolean;
    imageUrl?: string | null;
    ltv: number;
    liquidationThreshold: number;
}

export class MyAssetsResponseDto {
    data: MyAssetItemDto[];
    page: number;
    limit: number;
    totalData: number;
    totalPages: number;
}

export class MyPositionApyDto {
    apy: number;
}

export class MyPositionCollateralDto {
    collateral: string;
}

export class MyPositionAmountInUsdDto {
    amountInUsd: number;
}

export class MyPositionQueryDto {
    page?: number = 1;

    limit?: number = 10;

    type?: "LEND" | "BORROW";

    @IsOptional()
    @IsUUID()
    assetId?: string;
}

export class MyPositionItemDto {
    id: string;
    marketId: string;
    symbol: string;
    name: string;
    shares: number;
    baseAmount: number;
    amountInUsd: number;
    isCollateral: boolean;
    imageUrl?: string | null;
    side: "LEND" | "BORROW";
    maturity?: number | null;
    apr: number;
}

export class GetMyPositionResponseDto {
    data: MyPositionItemDto[];
    page: number;
    limit: number;
    totalData: number;
    totalPages: number;
}

export class SetAssetAsCollateralDto {
    assetIds: string[];
    isCollateral: boolean;
}

export class UserAssetDetailDto {
    assetId: string;
    symbol: string;
    name: string;
    imageUrl: string | null;
    /** Portfolio balance in human-readable units (NOT deducted) */
    totalBalance: number;
    /** Amount locked in open lend orders (human-readable) */
    lockedInOrders: number;
    /** Available = totalBalance - lockedInOrders (human-readable) */
    availableBalance: number;
    /** USD value of available balance */
    availableBalanceUsd: number;
    isCollateral: boolean;
    ltv: number;
    liquidationThreshold: number;
}

export class UserDebtDetailDto {
    assetId: string;
    debtAmount: number;
    debtAmountUsd: number;
}

export class UserDetailsResponseDto {
    assets: UserAssetDetailDto[];
    /** Total debt in USD = settled borrow debts + open borrow orders */
    totalDebtUsd: number;
    /** Settled debt only (from borrow_positions) */
    settledDebtUsd: number;
    /** Pending debt from open borrow orders */
    pendingDebtUsd: number;
    /** Total debt broken down per asset (settled only) */
    debts: UserDebtDetailDto[];
    /** Health factor; may be Infinity when there is no debt. */
    healthFactor: number;
    /** Total collateral value in USD */
    collateralUsd: number;
    /** Weighted LTV across all collateral (decimal, e.g. 0.75 = 75%) */
    weightedLtv: number;
}
