export interface AssetDto {
    id: string;
    name: string;
    symbol: string;
    decimals: number | null;
    imageUrl: string | null;
    tokenAddress: string;
}
