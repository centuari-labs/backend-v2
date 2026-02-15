export class TotalBalanceDto {
    totalDeposit: number;
}

export class AllTimeReturnDto {
    allTimeReturn: number;
}

export class NetAPYDto {
    netAPY: number;
}

export class MyPortfolioResponseDto {
    totalDeposit: number;
    allTimeReturn: number;
    netAPY: number;
}

export class healthFactorDto {
    healthFactor: number;
}

export class LendBorrowAssetResponseDto {
    suppliedAssets: number;
    borrowedAssets: number;
    healthFactor: number;
}

export class MyAssetDto {
    assetsId: string;
    amountInUsd: number;
    isCollateral: boolean;
}

export class GetMyAssetsQueryDto {
    page?: number = 1;

    limit?: number = 10;
}

export class MyAssetItemDto {
    symbol: string;
    name: string;
    walletBalance: number;
    amountInUsd: number;
    isCollateral: boolean;
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

    type?: 'LEND' | 'BORROW';
}

export class MyPositionItemDto {
    symbol: string;
    name: string;
    walletBalance: number;
    amountInUsd: number;
    isCollateral: boolean;
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