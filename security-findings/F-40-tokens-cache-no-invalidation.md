# F-40: `TokensService` cache has no invalidation — stale `decimals` / `tokenAddress` / `coingeckoId` until restart

**Severity**: 🟡 Moderate
**OWASP**: A04 Insecure Design, A08 Software and Data Integrity Failures
**CWE**: CWE-489 (Active Debug Code), CWE-664 (Improper Control of a Resource Through its Lifetime), CWE-561 (Dead Code)

## Summary

`TokensService.cache` is loaded once at boot and never re-read except via miss-fallback. Every consumer of token metadata — `prepareOrder` (decimals → base-unit conversion), `validateHealthFactor` (price lookup keyed on assetId), `withdraw` (decimals + tokenAddress for the on-chain call), `repay` (same) — pulls from this cache.

When the underlying `tokens` row changes (admin edit, migration, or schema fixup), the cache stays stale until the next process restart. A token's `decimals` going from `6` to `18` (typical USDC bridge variant) silently shifts every subsequent `humanToBaseUnits` and `parseUnits` call by 12 orders of magnitude, on the wrong side of solvency math.

This finding is conceptually tied to F-23 (HF in floats), F-24 (price service in-memory cache), F-29 (no balance check), and F-37 (Privy verification key file dead code). Cache-staleness alone isn't directly exploitable, but it amplifies every other money-math finding by guaranteeing that any operational change to `tokens` requires a coordinated restart to take effect.

## Evidence

### Cache load at boot, miss-fallback only

`src/tokens/tokens.service.ts:34-103`:

```typescript
private cache = new Map<string, Token>();

async onModuleInit(): Promise<void> {
    await this.loadAllTokensIntoCache();
}

private async loadAllTokensIntoCache(): Promise<void> {
    const tokens = await this.tokenRepository.getActiveTokens();
    const newCache = new Map<string, Token>();
    for (const token of tokens) {
        const key = token.id.toLowerCase();
        newCache.set(key, token);
    }
    this.cache = newCache;
}

async validateTokenByAssetId(assetId: string): Promise<Token> {
    await this.ensureCacheInitialized();

    const cached = this.getTokenFromCacheByAssetId(assetId);
    if (cached) {
        return cached;                                    // ⚠️ stale cache returned silently
    }

    const token = await this.tokenRepository.findByAssetId(assetId);
    if (!token) {
        throw new BadRequestException(`Token ${assetId} is not supported`);
    }

    const key = token.id.toLowerCase();
    this.cache.set(key, token);                           // ⚠️ once added, never refreshed
    ...
}
```

There's no `@Interval`, no eventbus subscription on token mutations, no admin endpoint that calls `loadAllTokensIntoCache()` after an update.

### Consumers everywhere

```bash
$ grep -rn "this.tokensService.\(validateTokenByAssetId\|getTokenDecimalsByAssetId\|getTokenByAssetId\)" src --include="*.ts" \
    | grep -v test | wc -l

# 18+ call sites: orders, portfolio, withdraw, repay, deposit
```

Every one of them assumes the cache is current. If it isn't, the math downstream is wrong.

### Tokens are not immutable in this schema

The `tokens` table has columns that are reasonable to mutate post-deploy:

- `coingecko_id` (added later for new pairs)
- `decimals` (rare but happens — token bridges sometimes change decimals on a redeploy)
- `token_address` (token redeployed on a fork)
- `is_loan_token` (admin policy change)
- `image_url` (cosmetic)
- `average_ltv` (risk-config change)

The `loadAllTokensIntoCache` only fires at `onModuleInit`, so any change to any of these is invisible until the operator restarts every backend instance.

## Impact

### A. Decimals drift = on-chain over/under-transfer

`humanToBaseUnits(amount, decimals)` and `parseUnits(amount, decimals)` use the cached value. If decimals changes from `6` (USDC) to `18` (some bridge variant) and the cache still says `6`:

- User requests withdraw `100`. Backend computes `parseUnits("100", 6) = 100_000_000` base units.
- On-chain contract expects 18-decimal units → reads `100_000_000` as `0.0000000001` ETH-equivalent.
- Or the inverse if the cache says `18` and the chain expects `6`: backend transfers `1e20` units of a 6-decimal token — many orders of magnitude too much.

This is exactly the kind of bug that has wiped DeFi treasuries (mistaken decimals between bridges and pools is a recurring postmortem topic).

### B. `coingecko_id` updates don't reach the price service

The price service (per F-24) joins on `tokens.coingeckoId`. When admin sets a previously-missing `coingeckoId`, **two caches** need to refresh: `TokensService.cache` and `PriceService.cache`. Today neither does. Until restart, HF math (per F-23) sees the asset as priceless → continues returning `0`/`Infinity` per F-24.

### C. `token_address` updates point operator-signed transfers at the wrong contract

`Treasury.withdraw(token_address, recipient, amount)` (per F-26) uses `tokensService.getTokenByAssetId(assetId).tokenAddress`. If `token_address` was updated in DB but cache still has the old value, the operator signs a transfer of an unrelated token (or a contract that no longer exists). Operator gas burned; user funds may move incorrectly if both addresses happen to be active.

### D. Cache pollution via miss-fallback is one-way

`validateTokenByAssetId` does `this.cache.set(key, token)` on miss. It never deletes. If a token is **soft-deleted** (`is_active = false`), the cache still serves it indefinitely.

### E. No invalidation hook for migrations

Operational pain: the team's normal workflow for adding a token is "insert into `tokens` table, set `coingecko_id`, restart backend". The restart is implicit in the runbook because of this cache. New on-call engineers have no signal that the restart is required, and may forget it. First symptom: "the new token shows missing prices".

## Recommended Solution

### 1. Add a TTL refresh

```typescript
@Injectable()
export class TokensService implements OnModuleInit {
    private cache = new Map<string, Token>();
    private cacheLoadedAt = 0;
    private static readonly CACHE_TTL_MS = 60_000;   // 1 minute

    async onModuleInit() {
        await this.loadAllTokensIntoCache();
    }

    @Interval(60_000)
    async refreshCache() {
        try {
            await this.loadAllTokensIntoCache();
        } catch (err) {
            this.logger.error(`Token cache refresh failed: ${(err as Error).message}`);
        }
    }

    private async ensureCacheInitialized() {
        if (this.cache.size > 0 && Date.now() - this.cacheLoadedAt < TokensService.CACHE_TTL_MS) {
            return;
        }
        // ... existing init
        this.cacheLoadedAt = Date.now();
    }
}
```

The `@Interval` keeps the cache hot. The `cacheLoadedAt` check ensures any miss-fallback path also refreshes if the cache is stale.

### 2. Invalidation hook for admin token operations

If/when the team adds an admin endpoint to mutate `tokens` (currently none, but adding one is plausible), have it explicitly invalidate:

```typescript
@Patch("tokens/:id")
@UseGuards(AdminSecretGuard)
async updateToken(@Param("id") id: string, @Body() patch: Partial<Token>) {
    const updated = await this.tokensRepository.update(id, patch);
    this.tokensService.invalidate(id);
    this.priceService.invalidatePrice(id);
    return updated;
}
```

`invalidate(assetId)` deletes the entry; the next miss reloads.

### 3. Cross-process invalidation via Postgres LISTEN/NOTIFY (or Redis pub/sub)

Multi-replica deployments need every backend to invalidate when the DB changes:

```typescript
async onModuleInit() {
    await this.loadAllTokensIntoCache();

    // Subscribe to token-change notifications
    const client = await this.dataSource.driver.master.connect();
    client.on("notification", (msg) => {
        if (msg.channel === "tokens_changed") {
            this.loadAllTokensIntoCache().catch((e) => this.logger.error(e.message));
        }
    });
    await client.query("LISTEN tokens_changed");
}
```

Migration:

```sql
CREATE OR REPLACE FUNCTION notify_tokens_changed() RETURNS trigger AS $$
BEGIN
    PERFORM pg_notify('tokens_changed', NEW.id::text);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tokens_changed_notify AFTER INSERT OR UPDATE OR DELETE ON tokens
    FOR EACH ROW EXECUTE FUNCTION notify_tokens_changed();
```

Now any DB change reaches every backend instance within sub-second.

### 4. Make `decimals` immutable post-creation (defense in depth)

If decimals ever needs to change, that should be a token retirement + new asset, not an in-place edit. Enforce at the DB layer:

```sql
CREATE OR REPLACE FUNCTION reject_decimals_change() RETURNS trigger AS $$
BEGIN
    IF OLD.decimals IS NOT NULL AND OLD.decimals <> NEW.decimals THEN
        RAISE EXCEPTION 'tokens.decimals is immutable after creation; create a new asset row instead';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tokens_decimals_immutable BEFORE UPDATE ON tokens
    FOR EACH ROW EXECUTE FUNCTION reject_decimals_change();
```

This is the actual fix for the worst-case scenario (Section A) — the cache becomes irrelevant because the DB value can't change anyway.

### 5. Cap miss-fallback population

`validateTokenByAssetId` should NOT add to the cache on miss with raw user input — `assetId` comes from request bodies and may be attacker-controlled. The current code does:

```typescript
const token = await this.tokenRepository.findByAssetId(assetId);
if (!token) {
    throw new BadRequestException(`Token ${assetId} is not supported`);
}
const key = token.id.toLowerCase();
this.cache.set(key, token);                                // ⚠️ writes
```

The token-not-found case throws so no write. Good. But the success-case write is only safe if you trust `findByAssetId` to be sane. Since miss is rare (cache is preloaded), simpler to drop the on-miss write entirely and just fall through to a cache reload:

```typescript
if (cached) return cached;
await this.loadAllTokensIntoCache();
const reloaded = this.getTokenFromCacheByAssetId(assetId);
if (!reloaded) throw new BadRequestException(`Token ${assetId} is not supported`);
return reloaded;
```

This makes the cache state consistent with the DB at every miss, instead of accumulating per-key.

### 6. Health endpoint exposes cache age

```typescript
@Get("health")
health() {
    return {
        ok: true,
        tokensCacheAgeMs: Date.now() - this.tokensService.cacheLoadedAt,
        priceCacheAgeMs: this.priceService.lastFetchAgeMs(),
    };
}
```

External monitoring can alert when cache age exceeds a threshold — operationally surfacing the kind of staleness this finding is about.

## Verification

```bash
# 1. TTL refresh
docker exec postgres psql -U centuari -d centuari -c \
    "UPDATE tokens SET coingecko_id='test-id' WHERE id='<asset>';"

# Wait > CACHE_TTL_MS, then:
curl http://localhost:8080/health
# Expected: tokensCacheAgeMs < TTL.

curl http://localhost:8080/portfolio/my-portfolio -H "Authorization: Bearer DEV_TOKEN_..."
# Expected: prices for the asset start showing up after the cache refreshes.

# 2. LISTEN/NOTIFY (multi-replica setup)
# Connect a second backend instance, update tokens table, assert both invalidate within 1s.

# 3. Decimals immutability
docker exec postgres psql -U centuari -d centuari -c \
    "UPDATE tokens SET decimals=18 WHERE id='<asset with decimals=6>';"
# Expected: ERROR — tokens.decimals is immutable after creation.

# 4. Miss-fallback reloads instead of per-key write
# Insert a new token directly; the *next* request for it should serve from a freshly-reloaded cache.
```

## References

- [PostgreSQL: NOTIFY / LISTEN](https://www.postgresql.org/docs/current/sql-notify.html)
- [NestJS: scheduling with `@nestjs/schedule`](https://docs.nestjs.com/techniques/task-scheduling)
- [Decimals confusion postmortem (Anchor Protocol, 2022)](https://blog.chainalysis.com/reports/anchor-protocol-2022/)
- [CWE-664: Improper Control of a Resource Through its Lifetime](https://cwe.mitre.org/data/definitions/664.html)
