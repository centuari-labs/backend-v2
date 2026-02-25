export interface RecentTradeDto {
    assetId: string;
    side: "LEND" | "BORROW";
    amount: string;
    rate: number;
    timestamp: number;
}

export interface SubscribeRecentTradesDto {
    assetId: string;
}
