import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import {
    PRICE_PROVIDER,
    type IPriceProvider,
} from "./interfaces/price-provider.interface";
import { TokensRepository } from "../tokens/repositories/tokens.repository";
import { EventsGateway } from "../core/websocket/websocket.gateway";

interface CacheEntry {
    price: number;
    updatedAt: Date;
}

@Injectable()
export class PriceService implements OnModuleInit {
    private readonly logger = new Logger(PriceService.name);

    /**
     * In-memory cache: assetId (Token.id) -> { price, updatedAt }
     */
    private cache = new Map<string, CacheEntry>();

    /**
     * Lazy fallback: promise for the initial fetch when cache is empty
     */
    private initPromise: Promise<void> | null = null;

    constructor(
        private readonly tokensRepository: TokensRepository,
        @Inject(PRICE_PROVIDER) private readonly priceProvider: IPriceProvider,
        private readonly eventsGateway: EventsGateway,
    ) {}

    async onModuleInit(): Promise<void> {
        await this.fetchAndUpdatePrices();
    }

    /**
     * Get the current USD price for a token by asset id.
     * Returns null if not found or cache not ready.
     * If cache is empty (cold start), triggers a fetch and awaits before returning.
     */
    async getPrice(assetId: string): Promise<number | null> {
        const normalized = assetId.toLowerCase();
        const entry = this.cache.get(normalized);

        if (entry) {
            return entry.price;
        }

        // Lazy fallback: cache empty, trigger fetch and await
        if (this.cache.size === 0 && this.initPromise) {
            await this.initPromise;
            return this.cache.get(normalized)?.price ?? null;
        }

        if (this.cache.size === 0) {
            this.initPromise = this.fetchAndUpdatePrices();
            await this.initPromise;
            this.initPromise = null;
            return this.cache.get(normalized)?.price ?? null;
        }

        return null;
    }

    /**
     * Get all cached prices: assetId -> price
     */
    getPrices(): Record<string, number> {
        const result: Record<string, number> = {};
        for (const [addr, entry] of this.cache.entries()) {
            result[addr] = entry.price;
        }
        return result;
    }

    /**
     * Check if the cache has been populated (ready to serve requests)
     */
    isCacheReady(): boolean {
        return this.cache.size > 0;
    }

    /**
     * Fetch prices from the provider and update the in-memory cache.
     * Called on module init and by the interval worker.
     */
    async fetchAndUpdatePrices(): Promise<void> {
        try {
            const tokens = await this.tokensRepository.getActiveTokens();
            if (tokens.length === 0) {
                this.logger.warn("No tokens found, skipping price fetch");
                return;
            }

            const pricesBySymbol = await this.priceProvider.fetchPrices(tokens);
            const newCache = new Map<string, CacheEntry>();
            const now = new Date();

            for (const token of tokens) {
                const price = pricesBySymbol[token.symbol];
                if (typeof price === "number") {
                    const normalizedAssetId = token.id.toLowerCase();
                    newCache.set(normalizedAssetId, { price, updatedAt: now });
                } else {
                    this.logger.debug(
                        `No price for token ${token.symbol} (assetId: ${token.id}, address: ${token.tokenAddress})`,
                    );
                }
            }

            // Replace cache atomically - keep stale data on failure, update on success
            this.cache = newCache;
            this.logger.log(`Price cache updated: ${this.cache.size} tokens`);

            // Broadcast updated prices over WebSocket so gateway stays in sync
            this.eventsGateway.broadcastPrices(this.getPrices());
        } catch (error) {
            this.logger.error(
                `Failed to fetch and update prices: ${(error as Error).message}`,
            );
            // Keep existing cache on failure (graceful degradation)
        }
    }
}
