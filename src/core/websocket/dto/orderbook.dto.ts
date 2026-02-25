export interface OrderbookLevel {
    rate: number;
    amount: string;
    orders: number;
}

export interface OrderbookUpdateDto {
    assetId: string;
    lend: OrderbookLevel[];
    borrow: OrderbookLevel[];
    timestamp: number;
}

export interface SubscribeOrderbookDto {
    assetId: string;
}
