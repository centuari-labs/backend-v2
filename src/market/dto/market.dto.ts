export class MarketItemDto {
    asset: {
        name: string;
        symbol: string;
        decimals?: number | null;
    };
    borrow_rate: number;
    lend_rate: number;
    collateral_factor: number;
}

export class MarketResponseDto {
    total_deposit: string;
    active_loans: string;
    markets: MarketItemDto[];
}