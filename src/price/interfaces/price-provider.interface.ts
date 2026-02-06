/**
 * Injection token for the price provider.
 */
export const PRICE_PROVIDER = Symbol("PRICE_PROVIDER");

import type { Token } from "../../tokens/entities/token.entity";

/**
 * Interface for price providers (e.g. CoinGecko).
 * Implementations fetch token prices from external APIs.
 */
export interface IPriceProvider {
    /**
     * Fetch current USD prices for the given tokens.
     * Uses coingecko_id from each token for live prices, or mock_price_usd for testnet-only tokens.
     * Returns a map of symbol -> price in USD.
     */
    fetchPrices(tokens: Token[]): Promise<Record<string, number>>;
}
