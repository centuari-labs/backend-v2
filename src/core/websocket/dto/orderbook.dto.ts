export interface OrderbookSideDto {
    price: number;
    apr: string;
    amount: string;
}

export interface OrderbookUpdateDto {
    assetId: string;
    marketId: string;
    lend: OrderbookSideDto | null;
    borrow: OrderbookSideDto | null;
    timestamp: number;
}

export interface SubscribeOrderbookDto {
    assetId: string;
    marketId: string;
}
