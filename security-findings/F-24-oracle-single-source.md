# F-24: Single-source oracle (CoinGecko) with no sanity bounds; missing prices silently treated as $0

**Severity**: 🔴 Critical (financial, correlated with F-23)
**OWASP**: A04 Insecure Design, A09 Security Logging and Monitoring Failures
**CWE**: CWE-345 (Insufficient Verification of Data Authenticity), CWE-754 (Improper Check for Unusual or Exceptional Conditions)

## Summary

The protocol's only price source is the public CoinGecko API:

- No API key, no fallback provider, no on-chain oracle (Chainlink/Pyth/etc.).
- A failed fetch silently keeps the previous cached value (which may be hours old) or returns nothing on cold start.
- Inside health-factor and order-USD math, a missing price is silently substituted with `0` — making collateral worthless OR making debt invisible, depending on which side of the equation it lands.
- No deviation cap, no staleness check, no minimum-quorum logic.

The price feed is the trust root for every collateralization decision in the system. Compromising or even briefly degrading it causes incorrect borrow/liquidation/withdraw decisions.

## Evidence

### Single source, no fallback

`src/price/providers/coingecko.provider.ts:8-65`:

```typescript
const COINGECKO_BASE_URL = "https://api.coingecko.com/api/v3";

@Injectable()
export class CoinGeckoProvider implements IPriceProvider {
    private readonly logger = new Logger(CoinGeckoProvider.name);

    async fetchPrices(tokens: Token[]): Promise<Record<string, number>> {
        const result: Record<string, number> = {};
        const tokensWithCoingeckoId = tokens.filter((t) => t.coingeckoId);
        const coinIds = [...new Set(tokensWithCoingeckoId.map((t) => t.coingeckoId).filter(Boolean))];
        if (coinIds.length === 0) return result;

        try {
            const url = `${COINGECKO_BASE_URL}/simple/price?ids=${coinIds.join(",")}&vs_currencies=usd`;
            const response = await fetch(url);                          // ⚠️ no timeout, no retry, no auth
            if (!response.ok) {
                throw new Error(`CoinGecko API error: ${response.status} ${response.statusText}`);
            }
            const data = (await response.json()) as Record<string, { usd?: number }>;

            for (const [coinId, priceData] of Object.entries(data)) {
                const price = priceData?.usd;
                if (typeof price === "number") {                        // ⚠️ no sanity bound (NaN / Infinity / negative)
                    const token = coinIdToToken.get(coinId);
                    if (token) result[token.symbol] = price;
                }
            }
        } catch (error) {
            this.logger.error(`Failed to fetch prices from CoinGecko: ${(error as Error).message}`);
            // ⚠️ Return mock prices only on failure - don't throw, allow stale cache to be used
        }
        return result;
    }
}
```

### Polling cadence

`src/price/price.worker.ts`:

```typescript
const FETCH_INTERVAL_MS = 60_000; // 60 seconds
@Interval(FETCH_INTERVAL_MS)
async handleInterval() {
    await this.priceService.fetchAndUpdatePrices();
}
```

Cold start: cache is empty until the first successful fetch. CoinGecko free tier limits to ~10–30 req/min and frequently 429s.

### Missing-price = $0 in HF math

`src/portfolio/portfolio.service.ts:463`:

```typescript
const priceUsd = priceMap.get(row.asset_id) ?? 0;   // ⚠️ silent substitution
```

`src/portfolio/helpers/health-factor.helpers.ts:75`:

```typescript
const valueUsd =
    amountHuman * (Number.isFinite(pos.priceUsd) ? pos.priceUsd : 0);
```

### Missing `coingeckoId` in DB

`src/price/providers/coingecko.provider.ts:14`:

```typescript
const tokensWithCoingeckoId = tokens.filter((t) => t.coingeckoId);
```

Any token that doesn't have `coingecko_id` set (e.g. recently added, or not listed on CoinGecko) is silently excluded. The HF math then sees `priceUsd = 0` for it.

## Impact

### Attack surfaces

**A. Cold-start exploit (no attacker required)**: from process boot until the first successful CoinGecko response, every HF query computes `valueUsd = 0` for every position. Borrow side: HF = `Infinity` (no debt valued) → withdrawals + collateral toggles all pass. Window is at most 60 s, longer if CoinGecko is rate-limiting the IP.

**B. Missing-price exploit (silent)**:
1. Add a debt token whose `coingeckoId` is unset (or temporarily delisted).
2. Borrow against it.
3. HF math values the debt at $0.
4. `totalDebtUsd <= 0` → `HEALTH_FACTOR_NO_DEBT` (Infinity).
5. Withdraw all collateral.

The reverse also holds: if an attacker can cause a *collateral* token's price to be missing, every legitimate user holding that collateral instantly looks under-collateralized.

**C. Stale-cache window**: CoinGecko responds with a wrong number once → cached forever until the next successful fetch overwrites it. The `try/catch` returns `{}` on errors, leaving the old cache in place. There's no staleness expiration.

**D. Single-source compromise**: CoinGecko has had outages, key compromises, and subtly-wrong responses for less-liquid pairs. A 90 % drop in CoinGecko's reported price for a collateral token instantly liquidates every borrower against that token; the protocol's solvency depends on CoinGecko's accuracy with no second opinion.

**E. CoinGecko rate-limit DoS**: 60 s polling + the public free tier is brittle. If the backend's IP is rate-limited (shared NAT, neighbor abuse), the cache silently goes stale and HF math drifts toward zero.

### Combined with other findings

- **F-23 (HF in floats)**: float drift + bad price = HF can flip across `1.0` in either direction.
- **F-22 (price service has no auth — it's read by `getMyHealthFactor` and broadcast via WS to all subscribers)**: cache poisoning would be visible everywhere instantly.
- **F-15 (WS no auth)**: any client subscribed to `prices` gets snapshots, helping attacker time the cold-start window.

## Recommended Solution

### 1. Treat missing prices as a hard error, never as $0

`src/portfolio/portfolio.service.ts`:

```typescript
const priceUsd = priceMap.get(row.asset_id);
if (priceUsd === undefined || !Number.isFinite(priceUsd) || priceUsd <= 0) {
    throw new ServiceUnavailableException(
        `Price unavailable for asset ${row.asset_id}; cannot compute health factor`,
    );
}
```

Same change in `prepareOrder`, `withdrawLendPosition`, `setAssetAsCollateral`, and any other site that pulls a price out of the cache.

### 2. Hard sanity bounds on every fetched price

`src/price/providers/coingecko.provider.ts`:

```typescript
const SANE_PRICE_RANGE = { min: 1e-8, max: 1e7 } as const;

for (const [coinId, priceData] of Object.entries(data)) {
    const price = priceData?.usd;
    if (
        typeof price !== "number" ||
        !Number.isFinite(price) ||
        price < SANE_PRICE_RANGE.min ||
        price > SANE_PRICE_RANGE.max
    ) {
        this.logger.warn(`Discarding out-of-range price ${price} for ${coinId}`);
        continue;
    }
    const token = coinIdToToken.get(coinId);
    if (token) result[token.symbol] = price;
}
```

### 3. Cache staleness expiration

`src/price/price.service.ts`:

```typescript
private static readonly MAX_STALENESS_MS = 5 * 60 * 1000;  // 5 min

async getPrice(assetId: string): Promise<number | null> {
    const entry = this.cache.get(assetId.toLowerCase());
    if (!entry) return null;
    if (Date.now() - entry.updatedAt.getTime() > PriceService.MAX_STALENESS_MS) {
        this.logger.warn(`Stale price for ${assetId} — last update ${entry.updatedAt.toISOString()}`);
        return null;   // force the caller into the strict "missing price" path above
    }
    return entry.price;
}
```

### 4. Deviation cap (TWAP-like)

Reject any new tick that deviates more than X% from the previous tick (or use a rolling median of last N ticks):

```typescript
private static readonly MAX_DEVIATION_PCT = 0.20;  // 20%

async fetchAndUpdatePrices() {
    const fresh = await this.priceProvider.fetchPrices(tokens);
    for (const [symbol, newPrice] of Object.entries(fresh)) {
        const old = this.cache.get(symbol);
        if (old && Math.abs(newPrice - old.price) / old.price > PriceService.MAX_DEVIATION_PCT) {
            this.logger.error(`Suspect price spike for ${symbol}: ${old.price} → ${newPrice} — keeping old`);
            continue;   // require manual override to accept
        }
        this.cache.set(symbol, { price: newPrice, updatedAt: new Date() });
    }
}
```

### 5. Multiple oracles with quorum

Add at least one independent source (Pyth network, Chainlink, on-chain Uniswap TWAP) and require agreement within a deviation band:

```typescript
@Injectable()
export class QuorumPriceProvider implements IPriceProvider {
    constructor(
        @Inject(COINGECKO_PROVIDER) private cg: IPriceProvider,
        @Inject(CHAINLINK_PROVIDER) private chainlink: IPriceProvider,
    ) {}

    async fetchPrices(tokens) {
        const [a, b] = await Promise.all([
            this.cg.fetchPrices(tokens),
            this.chainlink.fetchPrices(tokens),
        ]);
        const result: Record<string, number> = {};
        for (const t of tokens) {
            const pA = a[t.symbol]; const pB = b[t.symbol];
            if (pA === undefined || pB === undefined) continue;
            if (Math.abs(pA - pB) / Math.min(pA, pB) > 0.05) {
                this.logger.warn(`Oracle disagreement on ${t.symbol}: ${pA} vs ${pB}`);
                continue;
            }
            result[t.symbol] = (pA + pB) / 2;
        }
        return result;
    }
}
```

### 6. Use a CoinGecko Pro key (or another upstream) and add timeouts/retries

```typescript
const response = await fetch(url, {
    headers: { "x-cg-pro-api-key": process.env.COINGECKO_API_KEY ?? "" },
    signal: AbortSignal.timeout(10_000),
});
```

Pin to a tier with sane rate limits to prevent rate-limit-induced staleness.

### 7. Bootstrapping: refuse to serve money endpoints until the cache is hot

```typescript
@Injectable()
export class PriceReadyGuard implements CanActivate {
    constructor(private readonly priceService: PriceService) {}

    canActivate() {
        if (!this.priceService.isCacheReady()) {
            throw new ServiceUnavailableException("Price service warming up; please retry shortly");
        }
        return true;
    }
}

// Apply on /orders/*, /portfolio/repay, /portfolio/withdraw-lend-position, /withdraw, /portfolio/is-collateral
```

This closes the cold-start window deterministically — the endpoints just return 503 until the first fetch lands.

## Verification

```bash
# 1. Cold-start: simulate by clearing the cache (call into the service in dev)
curl http://localhost:8080/portfolio/my-health-factor -H "Authorization: Bearer DEV_TOKEN_..."
# Expected (post-fix): 503 "Price service warming up"

# 2. Missing-price: insert a token without coingecko_id, then borrow against it
docker exec postgres psql -U centuari -d centuari -c "UPDATE assets SET coingecko_id=NULL WHERE symbol='USDT';"
curl -X POST http://localhost:8080/orders/borrow/limit \
    -H "Authorization: Bearer DEV_TOKEN_..." \
    -d '{"assetId":"...USDT...","amount":"100","marketIds":[...],"rate":500}'
# Expected (post-fix): 503 "Price unavailable for asset ..."

# 3. Sanity bound: feed a 1e30 price into the provider stub
mockProvider.fetchPrices = async () => ({ USDC: 1e30 });
await priceService.fetchAndUpdatePrices();
expect(priceService.getPrice("USDC")).toBeNull();   // out of range, dropped

# 4. Deviation cap: prev=1.00, new=10.00 → rejected
```

## References

- [Oracle manipulation attack post-mortem (DeFi)](https://chainsecurity.com/oracle-manipulation-attacks-rising-impact-of-non-aligned-incentives/)
- [Pyth Network: Why use multiple oracle sources](https://docs.pyth.network/home)
- [Compound II: Anchor + posted price model](https://compound.finance/governance/proposals/13)
- [CWE-345: Insufficient Verification of Data Authenticity](https://cwe.mitre.org/data/definitions/345.html)
