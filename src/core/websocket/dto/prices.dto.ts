export interface PricesDto {
    /**
     * Mapping from assetId (Token.id) to current USD price.
     */
    prices: Record<string, number>;
}
