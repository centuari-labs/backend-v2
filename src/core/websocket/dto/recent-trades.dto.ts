export interface RecentTradeDto {
    loanToken: string;
    side: "LEND" | "BORROW";
    amount: string;
    rate: number;
    timestamp: number;
}

export interface SubscribeRecentTradesDto {
    loanToken: string;
}
