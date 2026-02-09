import { Injectable, Logger } from "@nestjs/common";
import type { Token } from "../../tokens/entities/token.entity";
import type { IPriceProvider } from "../interfaces/price-provider.interface";

const COINGECKO_BASE_URL = "https://api.coingecko.com/api/v3";

@Injectable()
export class CoinGeckoProvider implements IPriceProvider {
    private readonly logger = new Logger(CoinGeckoProvider.name);

    async fetchPrices(tokens: Token[]): Promise<Record<string, number>> {
        const result: Record<string, number> = {};

        // Fetch from CoinGecko for tokens that have coingecko_id set in DB
        const tokensWithCoingeckoId = tokens.filter((t) => t.coingeckoId);
        const coinIds = [...new Set(tokensWithCoingeckoId.map((t) => t.coingeckoId).filter(Boolean))];
        if (coinIds.length === 0) {
            return result;
        }

        try {
            const url = `${COINGECKO_BASE_URL}/simple/price?ids=${coinIds.join(",")}&vs_currencies=usd`;
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`CoinGecko API error: ${response.status} ${response.statusText}`);
            }

            const data = (await response.json()) as Record<string, { usd?: number }>;

            // Map back: coin ID -> token (for symbol lookup)
            const coinIdToToken = new Map<string, Token>();
            for (const token of tokensWithCoingeckoId) {
                if (token.coingeckoId) {
                    coinIdToToken.set(token.coingeckoId, token);
                }
            }

            for (const [coinId, priceData] of Object.entries(data)) {
                const price = priceData?.usd;
                if (typeof price === "number") {
                    const token = coinIdToToken.get(coinId);
                    if (token) {
                        result[token.symbol] = price;
                    }
                }
            }
        } catch (error) {
            this.logger.error(`Failed to fetch prices from CoinGecko: ${(error as Error).message}`);
            // Return mock prices only on failure - don't throw, allow stale cache to be used
        }

        return result;
    }
}
