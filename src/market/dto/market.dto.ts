export class MarketItemDto {
    asset: {
        /**
         * Asset identifier (Token.id UUID).
         */
        id: string;
        name: string;
        symbol: string;
        decimals?: number | null;
        imageUrl?: string | null;
    };
    /**
     * Single earliest-maturity market for this asset (market_id and maturity), or null if none.
     * maturity is Unix timestamp in seconds.
     */
    market: {
        market_id: string | null;
        maturity: number | null;
    };
    /**
     * Borrow rate expressed as a percentage (e.g. 5 = 5%).
     * Backed by a basis-points value in the database.
     */
    borrow_rate: number;
    /**
     * Lend rate expressed as a percentage (e.g. 4 = 4%).
     * Backed by a basis-points value in the database.
     */
    lend_rate: number;
    /**
     * Collateral factor (LTV) expressed as a percentage (e.g. 75 = 75%).
     * Backed by an average LTV in basis points in the database.
     */
    collateral_factor: number;
}

export class MarketResponseDto {
    total_deposit: string;
    active_loans: string;
    markets: MarketItemDto[];
}