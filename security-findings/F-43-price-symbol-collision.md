# F-43: `PriceService` ingests prices by `token.symbol` — duplicate symbols collide and the wrong asset gets the wrong price

**Severity**: 🟠 High (financial / multi-chain)
**OWASP**: A04 Insecure Design, A08 Software and Data Integrity Failures
**CWE**: CWE-665 (Improper Initialization), CWE-694 (Use of Multiple Resources with Duplicate Identifier), CWE-682 (Incorrect Calculation)

## Summary

`CoinGeckoProvider.fetchPrices` returns a `Record<string, number>` keyed by `token.symbol`, and `PriceService.fetchAndUpdatePrices` looks each token's price up by `token.symbol`. Two tokens that share a symbol — bridged variants of the same asset across chains, the canonical and a wrapper, or any naming collision — overwrite one another in the result map. Whichever token CoinGecko returns *last* wins for the symbol; every other token with that symbol gets the same price (probably wrong) or no price at all.

The cache is then keyed by `token.id` (asset UUID), but the value-side resolution went through symbol — so the per-asset cache silently inherits the cross-asset collision. Health-factor math (per F-23), borrow USD valuation (F-29 borrow path), and withdraw rate displays all read from this cache. Wrong price → wrong solvency math → wrong on-chain effects (per F-26 the operator signs whatever the backend authorizes).

## Evidence

`src/price/providers/coingecko.provider.ts:38-50`:

```typescript
const data = (await response.json()) as Record<string, { usd?: number }>;

const coinIdToToken = new Map<string, Token>();
for (const token of tokensWithCoingeckoId) {
    if (token.coingeckoId) {
        coinIdToToken.set(token.coingeckoId, token);     // ⚠️ last write wins
    }
}

for (const [coinId, priceData] of Object.entries(data)) {
    const price = priceData?.usd;
    if (typeof price === "number") {
        const token = coinIdToToken.get(coinId);
        if (token) {
            result[token.symbol] = price;                // ⚠️ symbol key
        }
    }
}
```

`src/price/price.service.ts:97-112`:

```typescript
const pricesBySymbol = await this.priceProvider.fetchPrices(tokens);
const newCache = new Map<string, CacheEntry>();
const now = new Date();

for (const token of tokens) {
    const price = pricesBySymbol[token.symbol];          // ⚠️ symbol lookup
    if (typeof price === "number") {
        const normalizedAssetId = token.id.toLowerCase();
        newCache.set(normalizedAssetId, { price, updatedAt: now });
    } else {
        this.logger.debug(
            `No price for token ${token.symbol} (assetId: ${token.id}, address: ${token.tokenAddress})`,
        );
    }
}
```

So the data flow is **symbol → price** at the provider, then **token (looked up by symbol) → assetId** at the service. There is no per-`(chainId, address)` disambiguation anywhere.

### Symbol uniqueness is not enforced

The `tokens` table schema (per `src/tokens/entities/token.entity.ts`) doesn't show a `UNIQUE(symbol)` constraint. The codebase already supports multiple chains:

```bash
$ grep -rnE "chainId|isLoanToken" src/tokens/entities/token.entity.ts
chainId: number;
isLoanToken: boolean;
```

So two `tokens` rows can legitimately share `symbol = "USDC"` with different `chainId` / `tokenAddress` / `decimals`. Even on a single chain, a redeployment of a token with the same symbol creates the collision.

### Coingecko-id collision is also possible

A second token row with the same `coingecko_id` (e.g. both pointing at `usd-coin`) would pass through `coinIdToToken.set(token.coingeckoId, token)` with the second token overwriting the first. Then only the second token gets a price; the first becomes priceless.

## Impact

### A. Wrong price applied to the wrong asset

If `tokens` has rows `{symbol: "USDC", chainId: 1, address: 0xA0b8…, decimals: 6}` and `{symbol: "USDC", chainId: 421614, address: 0x2697…, decimals: 6}`:

- CoinGecko returns `usd-coin: $1.00`.
- The first iteration of the build-price loop sets `result["USDC"] = 1.00`.
- The cache stores `{ id-of-token-1: 1.00, id-of-token-2: 1.00 }`. OK in this case because both are USD-pegged.

But:

- If `tokens` has rows `{symbol: "ETH", chainId: 1, ...}` and `{symbol: "ETH", chainId: 56, ...}` (where chain 56 is BSC's wrapped ETH historically depegged), and CoinGecko returns `ethereum: $3000`, both get $3000. The wrapped variant might trade at a discount/premium that's now invisible.
- If a malicious admin (or a SQL-injection variant — F-17 future) inserts a token row with `symbol: "USDC", coingecko_id: "shiba-inu"`, it overwrites the legitimate USDC's coingecko mapping. CoinGecko returns `shiba-inu: $0.00001`. Cache: `USDC = $0.00001`. Now the protocol treats USDC as effectively worthless. HF math (per F-23) crashes; withdraws get blocked or, if the math overshoots in the right direction, allow over-borrow.

### B. Empty-result side effect blanks legitimate prices

If a duplicate `coingecko_id` row is added, the *first* mapped token loses its price entry from `coinIdToToken` (the Map.set overwrite). At the service layer:

```typescript
const price = pricesBySymbol[token.symbol];
if (typeof price === "number") { ... } else { /* logged, no entry written */ }
```

Both tokens may end up unpriced (one because its `symbol` was overwritten, the other because the lookup misses). Cascades into F-24 (missing price → 0 → HF Infinity → bypass).

### C. Combined with multi-chain plans

The repo's `SUPPORTED_CHAINS` env supports comma-lists. Today `421614` only, but the architecture is designed for multi-chain. Adding chain 1 and chain 42161 simultaneously without symbol-uniqueness enforcement immediately collides USDC, ETH, USDT, WBTC, DAI — every major asset.

### D. Symbol case-sensitivity

`pricesBySymbol[token.symbol]` is case-sensitive. If `tokens.symbol` is sometimes uppercase (`USDC`) and sometimes mixed (`Usdc`) — there's no constraint preventing this — the lookup misses entirely, even when the price is in the result map. Silent cache miss.

### E. Combined with F-23 (HF in floats) and F-26 (operator signs)

Wrong price → wrong USD value of collateral / debt → HF crosses 1.0 in the wrong direction → operator signs an undercollateralized borrow OR refuses a legitimate withdrawal. This is the same outcome as F-24 but with a different trigger (DB row collision instead of CoinGecko outage). Defending only F-24 doesn't close it.

## Reproduction

```sql
-- Setup: insert a duplicate-symbol row.
INSERT INTO assets (id, name, symbol, decimals, token_address, coingecko_id, chain_id, is_loan_token)
VALUES (
    '11111111-1111-4111-8111-111111111111',
    'Bridged USDC',
    'USDC',                                 -- ⚠️ duplicate symbol
    6,
    '0xff00000000000000000000000000000000000000',
    'shiba-inu',                            -- ⚠️ unrelated coingecko id
    421614,
    true
);
```

Then trigger a price refresh (wait 60 s for the worker, or restart) and observe:

```bash
$ curl http://localhost:8080/portfolio/my-portfolio -H "Authorization: Bearer DEV_TOKEN_..."
# Expected today: USDC valued at the SHIB price (≈ $0.00001) for the polluted row;
# real USDC may also be priced wrong depending on order of overwrites.
```

## Recommended Solution

### 1. Key the price map by the canonical asset identifier, not by `symbol`

`src/price/providers/coingecko.provider.ts`:

```typescript
async fetchPrices(tokens: Token[]): Promise<Record<string, number>> {
    const result: Record<string, number> = {};   // keyed by token.id (asset UUID)

    const tokensWithCoingeckoId = tokens.filter((t) => t.coingeckoId);
    if (tokensWithCoingeckoId.length === 0) return result;

    const coinIdToTokens = new Map<string, Token[]>();   // ⬅ multi-token per coingeckoId
    for (const token of tokensWithCoingeckoId) {
        const arr = coinIdToTokens.get(token.coingeckoId!) ?? [];
        arr.push(token);
        coinIdToTokens.set(token.coingeckoId!, arr);
    }

    const coinIds = [...coinIdToTokens.keys()];
    try {
        const url = `${COINGECKO_BASE_URL}/simple/price?ids=${coinIds.join(",")}&vs_currencies=usd`;
        const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        if (!response.ok) throw new Error(`CoinGecko API error: ${response.status}`);

        const data = (await response.json()) as Record<string, { usd?: number }>;
        for (const [coinId, { usd }] of Object.entries(data)) {
            if (typeof usd !== "number" || !Number.isFinite(usd) || usd <= 0) continue;
            for (const token of coinIdToTokens.get(coinId) ?? []) {
                result[token.id] = usd;            // ⬅ key by asset id, not symbol
            }
        }
    } catch (error) {
        this.logger.error(`Failed to fetch prices: ${(error as Error).message}`);
    }
    return result;
}
```

`src/price/price.service.ts`:

```typescript
const pricesByAssetId = await this.priceProvider.fetchPrices(tokens);
const newCache = new Map<string, CacheEntry>();
const now = new Date();

for (const token of tokens) {
    const price = pricesByAssetId[token.id];
    if (typeof price === "number" && Number.isFinite(price) && price > 0) {
        newCache.set(token.id.toLowerCase(), { price, updatedAt: now });
    }
}
```

The interface contract changes from "Record by symbol" to "Record by asset id". Update `IPriceProvider`:

```typescript
// src/price/interfaces/price-provider.interface.ts
export interface IPriceProvider {
    fetchPrices(tokens: Token[]): Promise<Record<string, number>>;   // keyed by Token.id
}
```

A grep for downstream callers should already work since the service already keys the cache by `token.id.toLowerCase()` — the only change is dropping the `pricesBySymbol[token.symbol]` middleman.

### 2. Enforce uniqueness at the schema layer

If symbols are intended to be unique within a chain, enforce it:

```sql
-- per-chain symbol uniqueness
CREATE UNIQUE INDEX uq_tokens_chain_symbol ON tokens (chain_id, LOWER(symbol));

-- per-chain address uniqueness (catches accidental duplicates from a different angle)
CREATE UNIQUE INDEX uq_tokens_chain_address ON tokens (chain_id, LOWER(token_address));

-- coingecko_id uniqueness (the pricing key)
CREATE UNIQUE INDEX uq_tokens_coingecko_id ON tokens (coingecko_id) WHERE coingecko_id IS NOT NULL;
```

If a future migration tries to insert a duplicate, the DB rejects. No silent overwrites. (If the team intentionally allows duplicate symbols across chains, drop the chain-symbol index but keep the coingecko-id one.)

### 3. Sanity-bound prices at ingestion (covered in F-24, restated)

```typescript
const SANE = { min: 1e-8, max: 1e7 };
if (typeof usd !== "number" || !Number.isFinite(usd) || usd < SANE.min || usd > SANE.max) {
    this.logger.warn(`Discarding out-of-range price ${usd} for ${coinId}`);
    continue;
}
```

A polluted `coingecko_id` returning a wildly wrong price is dropped instead of cached.

### 4. Property-test for the pricing pipeline

```typescript
import fc from "fast-check";

it("never assigns the same price to two tokens with different coingecko_ids", () => {
    fc.assert(fc.property(
        fc.array(fc.record({
            id: fc.uuid(), symbol: fc.string(), coingeckoId: fc.string(),
        }), { minLength: 1, maxLength: 5 }),
        async (tokens) => {
            const provider = new CoinGeckoProvider(/* mocked fetch returning per-coinId prices */);
            const prices = await provider.fetchPrices(tokens as Token[]);
            for (const t of tokens) {
                if (prices[t.id] !== undefined) {
                    // assert price for this token only depends on its own coingeckoId
                    expect(prices[t.id]).toBeCloseTo(mockPriceFor(t.coingeckoId));
                }
            }
        },
    ));
});
```

## Verification

```sql
-- 1. Insert a duplicate-symbol row. Expected: index violation.
INSERT INTO assets (..., symbol, chain_id, ...) VALUES (..., 'USDC', 421614, ...);
-- Expected: ERROR: duplicate key value violates unique constraint "uq_tokens_chain_symbol"
```

```typescript
// 2. Two assets sharing only a symbol get distinct cache entries.
const tokens = [
    { id: "a-1", symbol: "USDC", coingeckoId: "usd-coin", ...},
    { id: "a-2", symbol: "USDC", coingeckoId: "usd-coin", ...},  // bridged
];
const prices = await priceProvider.fetchPrices(tokens);
expect(prices).toEqual({ "a-1": 1.0, "a-2": 1.0 });
```

```bash
# 3. End-to-end: same as the reproduction, but expect HF math to either:
#    - reject the polluted row at insert (preferred), or
#    - keep the legitimate USDC priced at $1 regardless of the polluted row.
```

## References

- [OWASP A04:2021 — Insecure Design](https://owasp.org/Top10/A04_2021-Insecure_Design/)
- [CWE-694: Use of Multiple Resources with Duplicate Identifier](https://cwe.mitre.org/data/definitions/694.html)
- [PostgreSQL: UNIQUE INDEX with predicates](https://www.postgresql.org/docs/current/sql-createindex.html)
- Real-world: [Cream Finance flash-loan exploit (2021)](https://rekt.news/cream-rekt-2/) — multi-source price collision on bridged variants
