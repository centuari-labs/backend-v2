export interface OrderbookLevel {
    rate: number;
    amount: string;
    orders: number;
}

export interface OrderbookUpdateDto {
    loanToken: string;
    lend: OrderbookLevel[];
    borrow: OrderbookLevel[];
    timestamp: number;
}

export interface SubscribeOrderbookDto {
    loanToken: string;
}
