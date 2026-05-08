# F-45: `OrdersWorker` retry loop burns operator gas every cycle without budget or root-cause check

**Severity**: 🟠 High (operator-cost / availability)
**OWASP**: A04 Insecure Design, A05 Security Misconfiguration
**CWE**: CWE-770 (Allocation of Resources Without Limits or Throttling), CWE-460 (Improper Cleanup on Thrown Exception), CWE-754 (Improper Check for Unusual or Exceptional Conditions)

## Summary

`OrdersWorker.placeLendOrderWithRetry` and `placeBorrowOrderWithRetry` follow the same three-attempt pattern: try → top up via faucet+deposit on failure → try again → reduce amount → try again. The top-up step calls `ensureGasForBot` (an operator-funded ETH transfer) followed by `faucetAndDeposit` (faucet `mintBatch` + Treasury `deposit` per token), and runs **regardless of why attempt 1 failed**. A transient DB error, a price-service cold start, an HF check rejecting the borrow, a rate-clamp adjustment, an unrelated NATS hiccup — any failure triggers the same expensive on-chain top-up.

Each on-chain call is signed by `OPERATOR_PRIVATE_KEY` (per **F-26**). Each cycle iterates over every market × every bot × both sides, so the worst-case gas cost grows multiplicatively with the assetMarketCache size. There is no daily / hourly / per-cycle gas budget, no error-classification (transient vs needs-funds), no circuit breaker.

On testnet today this just drains the operator's testnet ETH and burns RPC quota. On any non-test deployment, **a misbehaving worker is a money pump from the operator wallet to whoever happens to be the matching counterparty** — including legitimate users. Combined with **F-39** (bot rates not market-anchored) and **F-7** (faucet unauthenticated), the worker is the single largest expected-loss driver in the protocol.

## Evidence

### Per-attempt top-up regardless of cause

`src/orders/orders.worker.ts:743-793`:

```typescript
// Attempt 1: try directly
try {
    const response = await this.ordersService.createLendLimitOrder({...});
    await this.cancelIfSpreadExceeded(response.orderId, ...);
    return;
} catch (e) {
    this.logger.warn(`[LEND] Attempt 1 failed for ${bot.wallet.slice(0, 8)} ${symbol}: ${(e as Error).message}`);
}

// Faucet + deposit, then attempt 2
await this.topUpLoanTokenForBot(bot, assetId);   // ⚠️ unconditional, on every failure

try {
    const response = await this.ordersService.createLendLimitOrder({...});
    ...
}
```

Note the `catch` has no `if (isInsufficientFunds(e))` guard. A transient `BadRequestException`, a 503 from the price service, a HF rejection, even a temporary DB pool exhaustion all funnel into the same expensive top-up.

### `topUpLoanTokenForBot` chains 3+ on-chain calls

`src/orders/orders.worker.ts:598-637`:

```typescript
private async topUpLoanTokenForBot(bot, assetId) {
    const key = `lend-${bot.wallet}`;
    if (this.topUpInProgress.has(key)) return;
    this.topUpInProgress.add(key);
    try {
        // 1. Send ETH from operator to bot if needed (gas top-up)
        await this.ensureGasForBot(formattedKey, bot.wallet);

        // 2. Faucet mint (operator signs) + Treasury deposit (operator signs)
        await this.faucetAndDeposit(bot, specs, []);
        ...
    }
}
```

`ensureGasForBot` (lines 467-503): when bot ETH < `1e15 wei` (~0.001 ETH), operator sends `MIN_GAS_BALANCE_WEI` and `await waitForTransactionReceipt` — a full chain round-trip with operator gas paid.

`faucetAndDeposit` issues `mintBatch` against the faucet (operator-signed) and `Treasury.deposit` (operator-signed). Two more chain calls per asset.

So worst case per failed attempt: **3 chain transactions** + their wait-for-receipt cycles. Per asset. Per side. Per bot. Per worker tick.

### Worst-case multiplier per cycle

```typescript
async placeOrders() {
    if (!this.isEnabled || !this.initialized || this.cycleInProgress) return;
    if (this.assetMarketCache.length === 0) { ... }

    this.cycleInProgress = true;
    try {
        for (const entry of this.assetMarketCache) {
            this.refreshRatesForAsset(entry.assetId);
            for (const bot of this.botAccounts) {
                await this.placeLendOrderWithRetry(bot, entry);
                await this.placeBorrowOrderWithRetry(bot, entry);
            }
        }
    } finally {
        this.cycleInProgress = false;
    }
}
```

`6 bots × 2 sides × N assets × 3 attempts × 3 chain calls per failed attempt` = `108 × N` chain calls per failing cycle. With `@Interval(ORDER_CYCLE_INTERVAL_MS)` running every few seconds, the burn rate compounds.

### `cancelIfSpreadExceeded` adds another op

After every successful place, `cancelIfSpreadExceeded` may issue a cancel (operator-signed via the order flow that publishes to NATS, then settled on chain). Per F-25, that cancel races the matching engine and may overwrite a fill — adding free-money for the matching counterparty.

### No daily PnL accounting

```bash
$ grep -rn "botPnl\|loss budget\|daily.*loss\|gas.*budget" src --include="*.ts"
# no results
```

The worker has no concept of how much capital it's burned per day, per bot, per asset. It will keep running until the operator wallet is empty.

## Impact

### Direct cost (today, testnet)

- Operator wallet gas drain. ETH on Arbitrum Sepolia is free, but the operator wallet is a finite balance that legitimate user `Treasury.withdraw` calls also depend on. When it goes to zero, every user-facing on-chain action fails.
- Faucet contract drain. `mintBatch` mints from the faucet, which has its own balance. Once depleted, faucet calls (whether worker's or user's) revert.
- RPC provider quota. Every chain call is a `eth_sendRawTransaction`; failed-attempt loops eat the team's Alchemy/Infura monthly budget.

### Indirect cost (combined with other findings)

- **+ F-39 (bot rates not market-anchored)**: bot quotes at random rates → frequently mismatched → frequent failure → frequent top-up → operator gas bleed accelerates. The two findings together produce a feedback loop.
- **+ F-7 (faucet unauthenticated)**: an attacker can call the same faucet from outside, racing the worker for faucet contract balance. When the faucet runs dry, the worker keeps trying (no error classification), chewing operator gas on every retry.
- **+ F-25 (cancel race)**: every `cancelIfSpreadExceeded` is one race window. A worker doing many cancel-after-place cycles per minute is generating many race windows for an attacker to exploit.
- **+ F-26 (operator key everywhere)**: the operator wallet is also signing user `Treasury.withdraw`. When the worker drains its gas, *user withdrawals stop too*. This is not a "bot worker availability" problem — it's a "the protocol has no way to pay for user withdrawals" problem.
- **+ F-44 (CoinGecko fetch no timeout)**: a price-service stall causes `validateHealthFactor` to hang inside `createBorrowLimitOrder`. The bot's attempt-1 fails (or hangs and timeouts elsewhere), top-up runs, attempt-2 hangs the same way. The operator gas leaks while no actual liquidity is being placed.

### Failure modes that today look like "the bot just keeps trying"

- DB pool exhaustion → every `createLendLimitOrder` fails with a TypeORM `QueryFailedError`. Worker top-ups. Operator pays for chain calls that have nothing to do with the underlying problem.
- Validation rejection (e.g. F-23 / F-24 false-negative HF check on borrow) → top-ups, retries, all rejected the same way. Pure waste.
- Privy verification flake (F-37) → rejection cascade for the bots' privyUserIds since they go through the same auth path on order placement (depending on how the worker's account wiring is done).
- Price-service cold start (F-24) → first cycles after deploy fail HF; worker tops up bots that had enough balance already. Cold-start gas burn proportional to N assets × 6 bots × 3 attempts.

## Recommended Solution

### 1. Classify the error before topping up

```typescript
import { BadRequestException } from "@nestjs/common";

private isInsufficientFundsError(e: unknown): boolean {
    if (!(e instanceof Error)) return false;
    const msg = e.message.toLowerCase();
    return (
        msg.includes("insufficient") ||
        msg.includes("no balance") ||
        msg.includes("not enough") ||
        msg.includes("erc20: transfer amount exceeds")
    );
}

// Attempt 1
try {
    ...
    return;
} catch (e) {
    if (!this.isInsufficientFundsError(e)) {
        // Non-funds error — don't pay to top up.
        this.logger.warn(`[LEND] non-funds failure for bot ${bot.wallet.slice(0, 8)} ${symbol}: ${(e as Error).message}`);
        return;
    }
    this.logger.debug(`[LEND] attempt 1 funds shortfall, will top up`);
}

await this.topUpLoanTokenForBot(bot, assetId);
// Attempt 2 ...
```

This single change cuts most of the wasted top-ups. Validation errors, HF rejections, price-service issues, DB pool starvation — none of those need a faucet+deposit cycle.

### 2. Per-bot daily gas budget

```typescript
private static readonly MAX_DAILY_GAS_OPS = 50;
private dailyGasUsed = new Map<string, { count: number; resetAt: number }>();

private trackOperatorOp(botWallet: string): boolean {
    const now = Date.now();
    const bucket = this.dailyGasUsed.get(botWallet);
    if (!bucket || bucket.resetAt < now) {
        this.dailyGasUsed.set(botWallet, { count: 1, resetAt: now + 24 * 60 * 60 * 1000 });
        return true;
    }
    if (bucket.count >= OrdersWorker.MAX_DAILY_GAS_OPS) {
        this.logger.warn(`Bot ${botWallet.slice(0, 8)} hit daily gas budget; skipping`);
        return false;
    }
    bucket.count++;
    return true;
}

// In topUpLoanTokenForBot:
if (!this.trackOperatorOp(bot.wallet)) return;
```

Bounded worst-case per day. SREs can adjust the cap from observation.

### 3. Per-cycle short-circuit on faucet contract empty

```typescript
private async isFaucetExhausted(): Promise<boolean> {
    try {
        const balance = await this.viemService.readContract<bigint>(
            this.chainConfig.chainId,
            this.faucetAddress,
            faucetAbi,
            "balanceOf",
            [this.faucetAddress, /* sample token */],
        );
        return balance === 0n;
    } catch {
        return false;  // assume not empty on read failure
    }
}

async placeOrders() {
    ...
    if (await this.isFaucetExhausted()) {
        this.logger.warn("Faucet exhausted; pausing worker until refilled");
        return;
    }
    ...
}
```

Skips the entire cycle when topping up is impossible. Avoids the loops-burning-RPC-quota mode.

### 4. Track and surface metrics

Emit per-cycle counters: top-ups attempted, top-ups succeeded, attempts failed, ETH spent. SREs see the burn rate without inspecting logs.

```typescript
this.logger.log(
    `[cycle] topups=${this.cycleStats.topups} attempts=${this.cycleStats.attempts} ` +
    `placed=${this.cycleStats.placed} cancels=${this.cycleStats.cancels}`,
);
```

External monitoring on `topups > N` triggers an alert.

### 5. Disable the worker by default in production until F-39 lands

Today `ORDER_WORKER_ENABLED=true` in committed `.env`. Combined with the random-rate worker (F-39), enabling this in prod is a net liability. Default to `false` and require explicit opt-in with a market-anchored rate source.

```typescript
@Interval(ORDER_CYCLE_INTERVAL_MS)
async placeOrders() {
    if (!this.isEnabled || !this.initialized || this.cycleInProgress) return;
    if (process.env.NODE_ENV === "production" && process.env.ORDER_WORKER_PROD_ACK !== "yes") {
        this.logger.error("Refusing to run worker in production without ORDER_WORKER_PROD_ACK=yes");
        return;
    }
    ...
}
```

The "yes" ack is intentionally awkward — ops people have to read why before flipping it.

### 6. Cancel-aware top-up dedupe

`topUpInProgress` already dedupes concurrent top-ups for the same `(bot, asset)`. Extend it to a TTL so a successful top-up isn't re-run for at least N seconds:

```typescript
private topUpCooldown = new Map<string, number>();
private static readonly TOPUP_COOLDOWN_MS = 5 * 60 * 1000;

private async topUpLoanTokenForBot(bot, assetId) {
    const key = `lend-${bot.wallet}-${assetId}`;
    if (this.topUpCooldown.get(key) && this.topUpCooldown.get(key)! > Date.now()) return;
    if (this.topUpInProgress.has(key)) return;

    this.topUpInProgress.add(key);
    try {
        ...
        this.topUpCooldown.set(key, Date.now() + OrdersWorker.TOPUP_COOLDOWN_MS);
    } finally {
        this.topUpInProgress.delete(key);
    }
}
```

A bot that ran low and got topped up doesn't get topped up again for 5 minutes, regardless of how many failures happen in between.

### 7. Wait — confirm the bots are even necessary

For a real DeFi protocol, market making is usually delegated to professional MMs, not run by the protocol's own backend. The whole `orders.worker.ts` may be testnet-bootstrap scaffolding that should be deleted before mainnet. If so, F-39 + F-45 + F-7 are all closed by removing the worker entirely. Make that explicit: doc + CI gate.

## Verification

```bash
# 1. Error-classification gate
# Force a non-funds error (e.g. by mocking createLendLimitOrder to throw a HF-rejection BadRequest).
# Expected: log shows "non-funds failure", topUpLoanTokenForBot is NOT called.

# 2. Daily budget
for i in $(seq 1 60); do
    # trigger a forced top-up
done
# Expected: after MAX_DAILY_GAS_OPS, logs show "hit daily gas budget".

# 3. Faucet-exhausted short-circuit
# Set faucet contract balance to 0 in a test fixture.
# Expected: placeOrders logs "Faucet exhausted" and returns.

# 4. Cooldown
# Force a top-up at t=0 that succeeds.
# Force another failure at t=10s on the same (bot, asset).
# Expected: top-up is skipped due to cooldown.

# 5. Production refusal
NODE_ENV=production ORDER_WORKER_ENABLED=true pnpm run start
# Expected: worker logs the refusal; placeOrders returns immediately.
```

## References

- [OWASP A04:2021 — Insecure Design](https://owasp.org/Top10/A04_2021-Insecure_Design/)
- [CWE-770: Allocation of Resources Without Limits](https://cwe.mitre.org/data/definitions/770.html)
- [Aave / Compound: market-making is delegated, not protocol-run](https://docs.aave.com/risk/asset-risk/risk-parameters)
- See also F-7 (faucet unauth), F-26 (operator key blast radius), F-39 (bot rates random), F-44 (fetch no timeout)
