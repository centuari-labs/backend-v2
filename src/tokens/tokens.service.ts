import { BadRequestException, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Token } from "./entities/token.entity";
import { TokensRepository } from "./repositories/tokens.repository";

@Injectable()
export class TokensService implements OnModuleInit {
    private readonly logger = new Logger(TokensService.name);

    /**
     * In-memory cache of tokens keyed by asset id (Token.id).
     */
    private cache = new Map<string, Token>();

    /**
     * Lazy initialization guard so concurrent callers share the same init promise.
     */
    private initPromise: Promise<void> | null = null;

    constructor(
        private readonly tokenRepository: TokensRepository,
    ) { }

    async onModuleInit(): Promise<void> {
        // Eagerly warm the cache on startup. This can be changed to rely purely on
        // lazy initialization if needed for startup performance.
        await this.loadAllTokensIntoCache();
    }

    /**
     * Load all active tokens from the database and populate the in-memory cache
     * keyed by asset id (Token.id).
     */
    private async loadAllTokensIntoCache(): Promise<void> {
        const tokens = await this.tokenRepository.getActiveTokens();

        const newCache = new Map<string, Token>();
        for (const token of tokens) {
            const key = token.id.toLowerCase();
            newCache.set(key, token);
        }

        this.cache = newCache;
        this.logger.debug(`Token cache loaded with ${this.cache.size} assets`);
    }

    /**
     * Ensure the cache has been initialized. If already populated, this is a no-op.
     * If initialization is in progress, wait for it; otherwise start it.
     */
    private async ensureCacheInitialized(): Promise<void> {
        if (this.cache.size > 0) {
            return;
        }

        if (this.initPromise) {
            await this.initPromise;
            return;
        }

        this.initPromise = this.loadAllTokensIntoCache();
        try {
            await this.initPromise;
        } finally {
            this.initPromise = null;
        }
    }

    /**
     * Get a token from the in-memory cache using its asset id.
     */
    private getTokenFromCacheByAssetId(assetId: string): Token | null {
        const key = assetId.toLowerCase();
        return this.cache.get(key) ?? null;
    }

    /**
     * Validate that a token exists by its asset id (Token.id) using the cache
     * with a lazy DB fallback.
     *
     * @throws BadRequestException if token is not supported
     */
    async validateTokenByAssetId(assetId: string): Promise<Token> {
        await this.ensureCacheInitialized();

        const cached = this.getTokenFromCacheByAssetId(assetId);
        if (cached) {
            return cached;
        }

        const token = await this.tokenRepository.findByAssetId(assetId);
        if (!token) {
            throw new BadRequestException(`Token ${assetId} is not supported`);
        }

        const key = token.id.toLowerCase();
        this.cache.set(key, token);

        return token;
    }

    /**
     * Get token decimals by asset id (Token.id) using the cache-backed validator.
     *
     * @throws BadRequestException if token is not supported
     */
    async getTokenDecimalsByAssetId(assetId: string): Promise<number | null> {
        const token = await this.validateTokenByAssetId(assetId);
        return token.decimals ?? null;
    }

    /**
     * Convenience helper to retrieve a token by asset id.
     */
    async getTokenByAssetId(assetId: string): Promise<Token> {
        return this.validateTokenByAssetId(assetId);
    }
}
