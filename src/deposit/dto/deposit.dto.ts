export interface DepositTokenDto {
    id: string;
    symbol: string;
    name: string;
    tokenAddress: string;
    decimals: number | null;
    imageUrl: string | null;
    chainId: number | null;
}

export interface BalanceResponseDto {
    balance: string;
    formattedBalance: string;
    decimals: number | null;
    symbol: string;
}
