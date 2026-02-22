export interface OrderbookSideDto {
    price: number;
    apr: string;
    amount: string;
}

export interface OrderbookUpdateDto {
    loanToken: string;
    maturity: number;
    lend: OrderbookSideDto | null;
    borrow: OrderbookSideDto | null;
    timestamp: number;
}

export interface SubscribeOrderbookDto {
    loanToken: string;
    maturity: number;
}
