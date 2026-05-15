import { Injectable } from "@nestjs/common";
import { RedisService } from "../../core/redis/redis.service";

export interface RateLimitResult {
    allowed: boolean;
    remaining: number;
    retryAfterSeconds?: number;
}

/**
 * Fixed-window rate limiter on top of Redis. The first call in a window does
 * `INCR` then `EXPIRE`, all subsequent calls just `INCR`; whichever caller
 * crosses the limit gets `allowed: false` plus the remaining TTL so the API
 * can surface `retryAfterSeconds` in a 429 response.
 *
 * Generic enough that any module can adopt it. Phase 2 uses the key namespace
 * `collateral:write:${wallet}` with a 10/24h budget covering flag enqueue,
 * unflag dequeue, and on-chain unflag submit.
 */
@Injectable()
export class RedisRateLimiterService {
    constructor(private readonly redisService: RedisService) {}

    async consume(
        key: string,
        limit: number,
        windowSeconds: number,
    ): Promise<RateLimitResult> {
        const client = this.redisService.getClient();

        const count = await client.incr(key);
        if (count === 1) {
            await client.expire(key, windowSeconds);
        }

        if (count > limit) {
            const ttl = await client.ttl(key);
            return {
                allowed: false,
                remaining: 0,
                retryAfterSeconds: ttl > 0 ? ttl : windowSeconds,
            };
        }

        return { allowed: true, remaining: limit - count };
    }
}
