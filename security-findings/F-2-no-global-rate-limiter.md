# F-2: No global rate limiter

**Severity**: 🔴 Critical
**OWASP**: A04 Insecure Design, A05 Security Misconfiguration
**CWE**: CWE-770 (Allocation of Resources Without Limits or Throttling)

## Summary

`ThrottlerModule.forRoot()` is configured in `app.module.ts` but is never registered as a global guard. As a result, rate limiting is **only** active on `OrdersController` (via `WalletThrottlerGuard`). Other critical endpoints — `/auth/*`, `/withdraw`, `/faucet/*`, `/deposit/*`, `/portfolio/*` — have no throttling at all.

## Evidence

`src/app.module.ts:25-35`:
```typescript
ThrottlerModule.forRoot([
    { name: "short", ttl: 1000, limit: 5 },
    { name: "long", ttl: 60000, limit: 60 },
]),
```

There is no `{ provide: APP_GUARD, useClass: ThrottlerGuard }` in `providers`.

### Active test

```bash
$ for i in $(seq 1 100); do
    curl -s -o /dev/null -w "%{http_code}\n" \
      -X POST http://localhost:8080/auth/login \
      -H "Authorization: Bearer DEV_TOKEN_0x1111111111111111111111111111111111111111"
  done | sort | uniq -c

# Result: 100 200, 0 429
# 100 requests succeeded in 904ms
```

## Impact

- **F-2.1 → F-9 amplifier**: without a rate limit, the race condition in `redeemAccessCode` can be hammered.
- **F-2.2 → F-7 amplifier**: faucet drain can loop unbounded.
- **F-2.3 → F-13 amplifier**: timing attacks on `AdminSecretGuard` become feasible (32-byte secret = 64 hex chars; without rate limiting, brute-force timing analysis is viable).
- **F-2.4**: account enumeration via `/auth/login` — 100 req/sec to any endpoint.
- **F-2.5**: DB connection pool exhaustion via query-heavy `/portfolio/*` endpoints.

## Reproduction

See "Active test" above.

## Recommended Solution

### Option A: Global throttler (recommended)

`src/app.module.ts`:

```typescript
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";

@Module({
    imports: [
        // ...
        ThrottlerModule.forRoot([
            { name: "short", ttl: 1000, limit: 5 },
            { name: "long", ttl: 60000, limit: 60 },
        ]),
    ],
    providers: [
        {
            provide: APP_GUARD,
            useClass: ThrottlerGuard,
        },
    ],
})
export class AppModule {}
```

### Option B: Stricter per-endpoint trackers

For sensitive endpoints (auth, faucet, admin), use the existing `WalletThrottlerGuard` or add an `IpThrottlerGuard`:

```typescript
// src/common/guards/ip-throttler.guard.ts
@Injectable()
export class IpThrottlerGuard extends ThrottlerGuard {
    protected async getTracker(req: Record<string, any>): Promise<string> {
        return req.ips?.length ? req.ips[0] : req.ip;
    }
}
```

Apply on pre-auth routes (`/auth/login`, `/auth/validate`, `/faucet/*`):

```typescript
@Throttle({ short: { limit: 3, ttl: 1000 }, long: { limit: 10, ttl: 60000 } })
@UseGuards(IpThrottlerGuard)
@Post("login")
async login() { ... }
```

### Option C: Distributed rate limit (for multi-instance prod)

Use a Redis-backed throttler so limits are consistent across instances:

```typescript
import { ThrottlerStorageRedisService } from "@nest-lab/throttler-storage-redis";

ThrottlerModule.forRootAsync({
    useFactory: () => ({
        throttlers: [{ ttl: 60000, limit: 60 }],
        storage: new ThrottlerStorageRedisService(process.env.REDIS_URL),
    }),
}),
```

### Recommended limits per endpoint group

| Endpoint group | Per-IP/min | Per-wallet/min |
|----------------|-----------|----------------|
| `/auth/login`, `/auth/validate` | 5 | n/a (pre-auth) |
| `/auth/redeem-access-code` | 5 | 3 |
| `/auth/access-codes/*` (admin) | 10 | n/a |
| `/faucet/request-tokens` | 3 | 1/24h (custom) |
| `/withdraw`, `/portfolio/repay`, `/portfolio/withdraw-lend-position` | 30 | 10 |
| `/deposit/confirm` | 30 | 30 |
| `/orders/*` | already has `WalletThrottlerGuard` ✅ | |
| `/portfolio/my-*`, `/market/*` | 120 (read) | 120 |

## Verification

```bash
# After patch
for i in $(seq 1 20); do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST http://localhost:8080/auth/login \
    -H "Authorization: Bearer DEV_TOKEN_0x1111111111111111111111111111111111111111"
done

# Expected: a mix of 200 and 429 (Too Many Requests)
```

## References

- [NestJS Throttler docs](https://docs.nestjs.com/security/rate-limiting)
- [OWASP A04:2021 — Insecure Design](https://owasp.org/Top10/A04_2021-Insecure_Design/)
