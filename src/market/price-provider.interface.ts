export interface PriceProvider {
    getPrices(symbols: string[]): Promise<Map<string, number | null>>;
}

export const PRICE_PROVIDER = Symbol('PRICE_PROVIDER');
