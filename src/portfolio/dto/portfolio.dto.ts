export class TotalBalanceDto {
    totalDeposit: string;
}

export class AllTimeReturnDto {
    allTimeReturn: string;
}

export class NetAPYDto {
    netAPY: number;
}

export class MyPortfolioResponseDto {
    totalDeposit: string;
    allTimeReturn: string;
    netAPY: number;
}

export class healthFactorDto {
    healthFactor: number;
}

export class LendBorrowAssetResponseDto {
    suppliedAssets: string;
    borrowedAssets: number;
    healthFactor: number;
}

export class MyAssetDto {
    assetsId: string;
    amountInUsd: string;
    isCollateral: boolean;
}

export class GetMyAssetsQueryDto {
    page?: number = 1;

    limit?: number = 10;
}

export class MyAssetItemDto {
    symbol: string;
    name: string;
    walletBalance: string;
    amountInUsd: string;
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
    amountInUsd: string;
}

export class MyPositionQueryDto {
    page?: number = 1;

    limit?: number = 10;

    type?: 'LEND' | 'BORROW';
}

export class MyPositionItemDto {
    symbol: string;
    name: string;
    walletBalance: string;
    amountInUsd: string;
    isCollateral: boolean;
}

export class GetMyPositionResponseDto {
    data: MyPositionItemDto[];
    page: number;
    limit: number;
    totalData: number;
    totalPages: number;
}