# F-39: Bot worker rates use `Math.random()` mid with no market anchor — arbitrage-prone on any non-test deployment

**Severity**: 🟠 High (mainnet) / 🟡 Moderate (testnet only)
**OWASP**: A04 Insecure Design
**CWE**: CWE-330 (Use of Insufficiently Random Values), CWE-840 (Business Logic Errors)

## Summary

`OrdersWorker` runs 6 bot accounts that place lend and borrow limit orders on every market every cycle. Their quote rates come from `refreshRatesForAsset`, which seeds the per-asset mid rate with **`Math.random()` between `RATE_MIN + HALF_SPREAD` and `RATE_MAX - HALF_SPREAD`** and drifts it by `Math.floor(Math.random() * 5) - 2` bp per cycle. There is no anchor to:

- The on-chain interest-rate index for the asset.
- Any external rate oracle.
- The actual matched-trade history (`matches` table).
- The price service's USD anchor (which itself is fragile — see F-24).

The only counterparty awareness is `clampRateToSpread`, which clamps the bot's rate to be within 100 bp of the *opposite* side of the book. So if a user posts a single order at the bot's preferred edge, the bot's quote is dragged toward it — not toward the market clearing price.

On testnet (current `SUPPORTED_CHAINS=421614` Arbitrum Sepolia), bot capital is replenished from a faucet (per F-7, also unauthenticated) so the only loss is operator gas (F-26). On mainnet, the bot's randomly-priced quotes would be arbitraged within minutes by any user with a market-rate read, and bot capital would drain through the spread.

## Evidence

`src/orders/orders.worker.ts:33-46`:

```typescript
const RATE_MIN = 1;
const RATE_MAX = 10_000;
const MAX_SPREAD_BPS = 100;
const HALF_SPREAD = MAX_SPREAD_BPS / 2;
const HALF_SPREAD_PCT = 0.004;
const MID_RATE_DRIFT = 2;
const LEND_QUANTITY_USD_MIN = 10;
const LEND_QUANTITY_USD_MAX = 500;
```

`refreshRatesForAsset` (lines 1098-1128):

```typescript
private refreshRatesForAsset(assetId: string): { lend: number; borrow: number } {
    const existing = this.ratesByAsset.get(assetId);
    let mid: number;
    if (existing == null) {
        mid =
            RATE_MIN +
            HALF_SPREAD +
            Math.floor(Math.random() * (RATE_MAX - RATE_MIN - MAX_SPREAD_BPS + 1));   // ⚠️ uniform random
    } else {
        const drift =
            Math.floor(Math.random() * (MID_RATE_DRIFT * 2 + 1)) -
            MID_RATE_DRIFT;
        mid = Math.max(
            RATE_MIN + HALF_SPREAD,
            Math.min(RATE_MAX - HALF_SPREAD, existing.mid + drift),    // ⚠️ ±2 bp drift
        );
    }

    const offset = Math.max(1, Math.round(mid * HALF_SPREAD_PCT));
    const lend = Math.min(RATE_MAX, mid + offset);
    const borrow = Math.max(RATE_MIN, mid - offset);

    this.ratesByAsset.set(assetId, { lend, borrow, mid });
    return { lend, borrow };
}
```

So mid is a uniform random integer from `~51 .. 9950 bp`. That's anywhere from 0.51% APR to 99.50% APR. On a real lending market, the equilibrium is typically a few bp off the on-chain index — say 300–800 bp — and shifts with utilization. The bot's quote has no relationship to that.

`clampRateToSpread` (lines 1148-1180) only constrains the bot relative to the existing book:

```typescript
if (side === OrderSide.Lend && bestBorrowRate != null) {
    const maxLendRate = bestBorrowRate + MAX_SPREAD_BPS;
    clamped = Math.min(rate, maxLendRate);
} else if (side === OrderSide.Borrow && bestLendRate != null) {
    const minBorrowRate = bestLendRate - MAX_SPREAD_BPS;
    clamped = Math.max(rate, minBorrowRate);
}
```

If the book is empty (or all orders are stale), the bot's quote is unconstrained and the user is the next thing the bot quotes against — pulling the bot's quote toward the user's posted rate.

`Math.random()` itself is V8's xorshift128+; it's not crypto-secure. Once an attacker observes a few quotes, they can fingerprint the seed within statistical bounds and predict subsequent quotes. (V8's `Math.random` state is partially observable through repeated samples — research papers on V8 PRNG reversal are public.)

## Impact

### A. Bot capital drain on a real market (mainnet scenario)

Concrete attack on a deployed-to-mainnet variant:

1. Attacker observes bot's first lend quote of the cycle: e.g. `lend = 150 bp`.
2. The on-chain market rate for the asset is 800 bp. Attacker borrows from the bot at 150 bp (vastly under market).
3. Attacker simultaneously lends the borrowed amount at 800 bp on the chain's standard pool (or another protocol).
4. Net: attacker captures 650 bp spread per cycle, paid by the bot's capital.
5. Bot worker tops itself up via faucet/treasury (per F-7 + F-26) — the operator's gas + treasury balance bleeds with every cycle.

Because mid drifts only ±2 bp per cycle, the bot doesn't recover the gap until either it gets a new random seed or the book fills with real users' orders. Hours to days, depending on activity.

### B. Predictable random + observable quotes (any deployment)

`Math.random()` in Node.js is deterministic given V8's internal seed. If an attacker can observe a long enough sequence of bot quotes (e.g. via WS — see **F-15**: subscribe-orderbook is unauth), they can use known V8 PRNG inversion techniques to predict the next quote. Combined with **F-26** (bot wallets derive deterministically from the operator key), a sophisticated attacker can:

1. Recover the operator key (F-1: it's already in the repo).
2. Compute every bot wallet.
3. Predict every bot's next quote.
4. Pre-place opposing orders at the predicted rate.

The first three are already game-over (F-1 + F-26); this finding adds that even if F-1 / F-26 are fixed, prediction-by-observation alone is a viable attack on bot quotes.

### C. Self-crossing prevention is fragile

The comment in `orders.worker.ts:38-41` claims bot lend > borrow so bots don't cross. But `clampRateToSpread` is called per-side per-bot and the book changes between calls. A user posting a single tight bid or ask between the two can trick clampRateToSpread into pulling the bot's quote past its own opposite-side quote. Effect: bot lends to bot at a rate the worker never intended.

### D. Existing testnet impact

Even on Arbitrum Sepolia, the symptoms above translate to:

- **Operator gas drain**: every wasteful arbitrage costs operator gas via F-26.
- **DB / NATS noise**: bot orders + cancels + matches fill the `matches`, `orders`, and `lend/borrow_positions` tables with rows whose rates aren't representative of any market. Hard to debug real issues against this background.
- **Front-end UX**: charts of "lend rate over time" sourced from bot trades are pure noise.

## Recommended Solution

### 1. Anchor bot mid to a real market signal

Drop `Math.random()` for mid. Compute mid from one of:

- **On-chain utilization curve**: query the lending pool's current borrow APR (e.g. Aave-style `getReserveData`); set mid = that APR.
- **Recent matched trades**: take a volume-weighted average of `matches` rows in the last 5 minutes for the asset; bot mid = that VWAP.
- **External index**: pull a rate from a vetted source (e.g. Aave / Morpho RPC) per asset.

```typescript
private async refreshRatesForAsset(assetId: string): Promise<{ lend: number; borrow: number }> {
    const onChainBorrowApr = await this.aaveOracle.getCurrentBorrowApr(assetId);  // bps
    const recentVwap = await this.matchRepository.getVwapBps(assetId, /* lookback */ 5 * 60 * 1000);

    // Use VWAP if recent activity exists, else fall back to the on-chain anchor.
    const mid = recentVwap ?? onChainBorrowApr;

    const offset = Math.max(1, Math.round(mid * HALF_SPREAD_PCT));
    const lend = Math.min(RATE_MAX, mid + offset);
    const borrow = Math.max(RATE_MIN, mid - offset);

    this.ratesByAsset.set(assetId, { lend, borrow, mid });
    return { lend, borrow };
}
```

### 2. Add a per-bot loss budget

If bots are providing liquidity, treat them like a market maker: track the realized PnL on bot positions and stop quoting once a daily loss threshold is hit:

```typescript
private static readonly MAX_DAILY_BOT_LOSS_USD = 100;

private async shouldBotQuote(bot: BotAccount): Promise<boolean> {
    const pnlToday = await this.botPnlService.getTodayUsd(bot.wallet);
    if (pnlToday < -OrdersWorker.MAX_DAILY_BOT_LOSS_USD) {
        this.logger.warn(`Bot ${bot.wallet.slice(0, 8)} loss budget exhausted; pausing quotes for the day`);
        return false;
    }
    return true;
}
```

This bounds the worst-case operator capital loss per day even if the rate-source is wrong.

### 3. If `Math.random()` stays anywhere on a financial path, swap for `crypto.randomInt`

For drift / quantity randomization that doesn't need cryptographic strength but should still resist V8 PRNG inversion:

```typescript
import { randomInt } from "node:crypto";

const drift = randomInt(-MID_RATE_DRIFT, MID_RATE_DRIFT + 1);
const amount = LEND_QUANTITY_USD_MIN + randomInt(0, LEND_QUANTITY_USD_MAX - LEND_QUANTITY_USD_MIN + 1);
```

`crypto.randomInt` uses `/dev/urandom`-equivalent randomness. Single line change, removes the prediction-by-observation attack.

### 4. Reduce broadcast surface for bot quotes

`clampRateToSpread` reads `getBestRatesForAsset` from the DB before placing each order. The DB read is correct; the issue is that **the user's quote is in the same `bestRate` aggregate**. A user who posts a tight quote intentionally pulls the bot toward their target.

Mitigation: compute `bestRate` excluding bot accounts so the bot only reacts to real users, not to itself or other bots:

```typescript
async getBestRatesForAsset(assetId: string): Promise<...> {
    return this.createQueryBuilder("o")
        .where("o.asset_id = :a", { a: assetId })
        .andWhere("o.account_id NOT IN (SELECT id FROM accounts WHERE privy_user_id LIKE 'did:privy:worker-bot-%')")
        .andWhere("o.status IN (:...statuses)", { statuses: [Open, PartiallyFilled] })
        ...
}
```

This is also defense-in-depth against a real user weaponizing the spread-clamp logic.

### 5. Stop the bot worker entirely on production until rate-source is fixed

```typescript
@Interval(ORDER_CYCLE_INTERVAL_MS)
async placeOrders() {
    if (process.env.NODE_ENV === "production" && process.env.ORDERS_WORKER_RATES === "random") {
        this.logger.error("Refusing to run random-rate worker in production");
        return;
    }
    ...
}
```

Or simpler: ship the worker disabled by default in production (`ORDER_WORKER_ENABLED=false`) and gate enabling it on having a real rate source configured.

### 6. If this is *only* meant for testnet liquidity bootstrapping, make that explicit

Doc the limitation, add a CI check that fails if `process.env.NODE_ENV === "production"` and `ORDER_WORKER_ENABLED === "true"`. Even comments in the code today (`mid drift per cycle (small so old orders stay in-band)`) read like a real market-making strategy. Future maintainers will assume it works in production. Make the constraint explicit:

```typescript
/**
 * ⚠️ Testnet-only. Mid rate is uniform-random; do not run this worker on a real market.
 * See security-findings/F-39 for context.
 */
```

## Verification

```bash
# 1. After rate anchoring, run a synthetic test:
#    - simulate Aave APR = 800 bp
#    - run one cycle; assert bot mid is within ±50 bp of 800 across all bots

# 2. Loss-budget engaged:
#    - simulate matched trades that show bot has -$120 PnL today
#    - run a cycle; assert no orders placed by that bot

# 3. crypto.randomInt:
node -e "console.log(typeof require('node:crypto').randomInt(0, 10))"
# Expected: 'number'

# 4. Bot accounts excluded from bestRate:
docker exec postgres psql -U centuari -d centuari -c \
    "SELECT MAX(rate) FROM orders o JOIN accounts a ON o.account_id = a.id
     WHERE a.privy_user_id NOT LIKE 'did:privy:worker-bot-%' AND status='open' AND side='lend';"
# Use this in clampRateToSpread queries instead of the unfiltered MAX.

# 5. Production refusal:
NODE_ENV=production ORDER_WORKER_ENABLED=true ORDERS_WORKER_RATES=random pnpm run start
# Expected: process logs the refusal; placeOrders returns immediately.
```

## References

- [V8 `Math.random` PRNG reversal research (Lin & Chevalier, 2019)](https://research.checkpoint.com/2020/playing-with-mathrandom/)
- [Aave: Interest rate model](https://docs.aave.com/risk/liquidity-risk/borrow-interest-rate)
- [Morpho: Vault rate sources](https://docs.morpho.org/morpho-vaults/concepts/rate-models)
- [CWE-330: Use of Insufficiently Random Values](https://cwe.mitre.org/data/definitions/330.html)
- [CWE-840: Business Logic Errors](https://cwe.mitre.org/data/definitions/840.html)
- Real-world: [Wormhole price-feed exploit; market-makers running unanchored quotes (Avraham, 2022)](https://medium.com/coinmonks/the-anatomy-of-a-defi-attack-the-wormhole-exploit-1f0bc0eee8ac)
