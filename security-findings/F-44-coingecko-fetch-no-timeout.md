# F-44: `CoinGeckoProvider.fetchPrices` calls `fetch` with no timeout — worker stalls under upstream slowness

**Severity**: 🟡 Moderate
**OWASP**: A04 Insecure Design, A06 Vulnerable and Outdated Components
**CWE**: CWE-400 (Uncontrolled Resource Consumption), CWE-833 (Deadlock)

## Summary

`CoinGeckoProvider.fetchPrices` calls Node's global `fetch` without an `AbortSignal`, without `signal: AbortSignal.timeout(...)`, and without a `Promise.race` timeout. Node 22's undici defaults to a long body timeout (configurable per agent, but not per call). When CoinGecko's free tier is slow or stuck (rate-limited, CDN issue, partial response), the price worker's `await fetch(url)` doesn't return for tens of seconds to minutes.

`PriceWorker.handleInterval` runs on `@Interval(60_000)`. If a fetch takes longer than the interval, NestJS schedules another, both racing the same `priceService.cache`. With `fetchAndUpdatePrices` swallowing errors and leaving stale data on failure (per F-24), the result is that the cache update either disappears or arrives in the wrong order, and the worker thread stalls on whichever fetch is the slowest.

Combined with **F-2** (no rate limit) and **F-24** (single oracle, no fallback), this is the operational mechanism that makes a CoinGecko outage cascade through the whole protocol.

## Evidence

`src/price/providers/coingecko.provider.ts:26-32`:

```typescript
try {
    const url = `${COINGECKO_BASE_URL}/simple/price?ids=${coinIds.join(",")}&vs_currencies=usd`;
    const response = await fetch(url);            // ⚠️ no signal, no timeout
    if (!response.ok) {
        throw new Error(
            `CoinGecko API error: ${response.status} ${response.statusText}`,
        );
    }
    ...
}
```

`src/price/price.worker.ts`:

```typescript
const FETCH_INTERVAL_MS = 60_000;

@Injectable()
export class PriceWorker {
    @Interval(FETCH_INTERVAL_MS)
    async handleInterval(): Promise<void> {
        try {
            await this.priceService.fetchAndUpdatePrices();
        } catch (error) {
            this.logger.error(`Scheduled price fetch failed: ${(error as Error).message}`);
        }
    }
}
```

`@Interval` from `@nestjs/schedule` doesn't gate against in-flight runs by default. If `fetchAndUpdatePrices` is still awaiting a slow fetch when the next 60 s tick fires, a second `fetchAndUpdatePrices` runs concurrently. Two slow fetches in flight, each holding microtask slots and an undici socket.

CoinGecko free-tier rate limits historically:
- 5–15 requests per minute for `/api/v3/simple/price` from a single IP.
- Slow / 5xx responses common during traffic spikes.
- Returns a `Retry-After` header that this code ignores.

## Impact

- **F-44.1 — Price worker stalls indefinitely on CoinGecko hang**: a connection that's accepted but never returns a response body keeps `fetch` open until Node's default socket idle timeout (which can be effectively unbounded depending on undici agent config). The worker thread's last successful price update gets older and older.
- **F-44.2 — Concurrent runs race the cache**: two `fetchAndUpdatePrices` calls in flight build separate `newCache` Maps and assign `this.cache = newCache` whenever each finishes. The second-to-finish wins. If the first run had fresher data (slower because of more tokens), it gets stomped on by the second.
- **F-44.3 — Combined with F-24 (single source) + F-2 (no rate limit)**: an attacker hammering an endpoint that calls `priceService.getPrice` doesn't directly stall the worker, but slow CoinGecko + concurrent worker runs + `priceService.getPrice` lazy-fallback (`if (this.cache.size === 0) { initPromise = fetchAndUpdatePrices(); await initPromise; }`) all interact. A cold-start window plus a slow CoinGecko response means every API request that touches a price hangs until the fetch completes.
- **F-44.4 — Combined with F-24's "no API key"**: free tier IP-based rate limiting means a single bad actor on a shared egress IP can pin our quota, causing every fetch to slowly time out.
- **F-44.5 — Operational opacity**: there's no metric showing fetch latency or success rate. SREs see "old prices" without obvious causation. F-43 + F-44 together produce silent miscalculations in HF math.

## Reproduction

```bash
# Simulate slow CoinGecko by pointing the provider at a hanging endpoint.
# In a dev shell:
COINGECKO_BASE_URL=http://127.0.0.1:9999 pnpm run start:dev   # nothing listens on 9999

# `fetch` initiates a TCP connect, hangs on no response, never times out.
# After 60 s another fetch attempt fires alongside it.
# After 5 minutes the dev shell shows the worker still trying to connect.
```

Or simpler — script a deliberately slow upstream:

```bash
# A "slow loris" mock: accepts the request, drips one byte per minute.
node -e "
require('http').createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    setInterval(() => res.write(' '), 60_000);  // never finishes
}).listen(9999);
"

COINGECKO_BASE_URL=http://127.0.0.1:9999 pnpm run start:dev
# Observe `priceService.cache` going stale, `fetchAndUpdatePrices` never returning.
```

## Recommended Solution

### 1. Bound the fetch with `AbortSignal.timeout`

`src/price/providers/coingecko.provider.ts`:

```typescript
const FETCH_TIMEOUT_MS = 8_000;        // < the @Interval cadence

const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
});
```

If CoinGecko doesn't respond within 8 seconds, the fetch rejects. The worker's `try/catch` logs and exits. Stale cache survives one cycle (per F-24's graceful-degradation note); next cycle retries. No accumulating in-flight requests.

### 2. Prevent overlapping `@Interval` runs

`src/price/price.worker.ts`:

```typescript
@Injectable()
export class PriceWorker {
    private inFlight = false;

    @Interval(FETCH_INTERVAL_MS)
    async handleInterval(): Promise<void> {
        if (this.inFlight) {
            this.logger.warn("Price fetch already in flight; skipping this tick");
            return;
        }
        this.inFlight = true;
        try {
            await this.priceService.fetchAndUpdatePrices();
        } catch (error) {
            this.logger.error(`Scheduled price fetch failed: ${(error as Error).message}`);
        } finally {
            this.inFlight = false;
        }
    }
}
```

A single in-flight guard means a stuck fetch doesn't multiply across ticks.

### 3. Honour `Retry-After` and exponential backoff

```typescript
let lastBackoffMs = 0;
async fetchPrices(tokens: Token[]): Promise<Record<string, number>> {
    if (lastBackoffMs > Date.now()) {
        this.logger.debug(`Skipping CoinGecko (backing off until ${new Date(lastBackoffMs).toISOString()})`);
        return {};
    }
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
        if (response.status === 429) {
            const retryAfter = Number(response.headers.get("retry-after") ?? "30");
            lastBackoffMs = Date.now() + retryAfter * 1000;
            return {};
        }
        ...
    } catch (err) {
        ...
    }
}
```

CoinGecko gets to throttle us cleanly instead of being pummelled and slowing the upstream.

### 4. Use a Pro key + tighter monitoring (covered in F-24)

The 8 s timeout, in-flight guard, and Retry-After honoring are all defensive — but the durable fix is to pay for a CoinGecko Pro key (or another upstream) and have a sane SLO. F-24 §6 covers this; this finding is the operational complement.

### 5. Surface fetch metrics

```typescript
this.logger.log(
    `Price fetch ok: ${this.cache.size} tokens, ${Date.now() - startedAt}ms`,
);
// Emit a metric: increment 'price_fetch_total{status="ok"}' by 1, observe duration.
```

External monitoring can alert when:

- `price_fetch_total{status="error"}` rate exceeds N/min, or
- p99 fetch latency > 5 s, or
- `cache_age_sec` > 3 min.

These are the same telemetry hooks F-40 §6 recommends for token cache age.

### 6. Defensive close on response body

If the team ever wants to support large responses (multiple `simple/price` chunks), explicitly close the body on error:

```typescript
const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
try {
    if (!response.ok) {
        // drain and discard body so undici returns the socket to the pool
        await response.body?.cancel();
        throw new Error(...);
    }
    const data = await response.json();
    ...
} catch (err) {
    await response.body?.cancel().catch(() => {});
    throw err;
}
```

Not strictly necessary at this scale, but cheap belt-and-braces against future use of larger CoinGecko endpoints.

## Verification

```bash
# 1. Timeout
node -e "
require('http').createServer(() => { /* never replies */ }).listen(9999);
"
COINGECKO_BASE_URL=http://127.0.0.1:9999 pnpm run start:dev
# Expected: log line 'Failed to fetch prices: TimeoutError: ...' within 8 s.

# 2. In-flight guard
# Force a 7s fetch with a slow but eventually-replying mock; trigger handleInterval twice in 1s.
# Expected: second run logs 'Price fetch already in flight; skipping this tick'.

# 3. Retry-after honoured
# Mock returns 429 Retry-After: 60. Subsequent ticks within 60s should skip the fetch entirely.

# 4. Property test
# Random token list; fetch; assert no fetch ever exceeds the timeout boundary.
```

## References

- [Node.js fetch — `AbortSignal.timeout()`](https://nodejs.org/api/globals.html#abortsignaltimeoutdelay)
- [CoinGecko API rate limits](https://docs.coingecko.com/reference/common-errors-rate-limit)
- [`@nestjs/schedule` — Interval / overlapping execution](https://docs.nestjs.com/techniques/task-scheduling)
- [CWE-400: Uncontrolled Resource Consumption](https://cwe.mitre.org/data/definitions/400.html)
- [Slow Loris pattern](https://en.wikipedia.org/wiki/Slowloris_(cyber_attack)) — the inverse of this issue, but the mechanism (sockets held open) is identical
