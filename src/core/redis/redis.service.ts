import {
    Injectable,
    Logger,
    type OnModuleDestroy,
    type OnModuleInit,
} from "@nestjs/common";
import Redis from "ioredis";

/**
 * Minimal ioredis wrapper. Lifecycle-managed by NestJS so the connection is
 * established on app boot and gracefully closed on shutdown.
 *
 * Backend-v2 uses Redis only for the collateral rate limiter (Phase 2). If we
 * later need pub/sub or stream consumers, this is the place to add them.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(RedisService.name);
    private client: Redis | null = null;

    onModuleInit(): void {
        const url = process.env.REDIS_URL ?? "redis://localhost:6379";
        this.client = new Redis(url, {
            // Lazy connect lets the constructor return synchronously and
            // surface connection errors via the 'error' event listener
            // rather than throwing during boot.
            lazyConnect: false,
            maxRetriesPerRequest: 3,
        });

        this.client.on("error", (err) => {
            this.logger.error(`Redis error: ${err.message}`);
        });
        this.client.on("connect", () => {
            this.logger.log(`Connected to Redis at ${url}`);
        });
    }

    async onModuleDestroy(): Promise<void> {
        if (this.client) {
            await this.client.quit();
            this.client = null;
            this.logger.log("Redis connection closed");
        }
    }

    getClient(): Redis {
        if (!this.client) {
            throw new Error("RedisService not initialized");
        }
        return this.client;
    }
}
