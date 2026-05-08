# F-46: `viemService.writeContract` queue head-of-line blocks on a hung receipt; no timeouts anywhere on the chain path

**Severity**: 🟠 High (availability)
**OWASP**: A04 Insecure Design, A05 Security Misconfiguration
**CWE**: CWE-833 (Deadlock), CWE-400 (Uncontrolled Resource Consumption), CWE-1322 (Use of Blocking Code in Single-threaded Non-blocking Context)

## Summary

`ViemService.writeContract` chains every transaction for a given `(chainId, account)` onto a single Promise queue (`txQueues`). Inside `executeWriteContract`, if `options.waitForReceipt` is set, the call awaits `publicClient.waitForTransactionReceipt({ hash })` with **no timeout**. viem polls until the tx mines; if the tx is stuck (gas underpriced after a baseFee spike, RPC outage, mempool replacement, dropped tx), the await never resolves.

Because the queue serializes on the operator's address and **every user-facing on-chain action (withdraw, repay, withdrawLendPosition, faucet, bot top-up) is signed by the same `OPERATOR_PRIVATE_KEY`** (per F-26), a single hung tx head-of-line blocks every other operator-signed write. New `writeContract` calls chain onto the stuck Promise and never resolve either. From the user's perspective, withdraw HTTP requests hang indefinitely; combined with **F-2** (no global rate limiter), the connection pool exhausts within minutes.

The same "no timeout" pattern appears in three other places that the threat model already touches but is worth restating here as the unifying root cause:

- `CoinGeckoProvider.fetchPrices` (per F-44)
- `DatabaseService` queries (no `statement_timeout`, per F-21)
- `viemService.getTransactionReceipt` (used by F-6's `/deposit/confirm` path)

The system has no end-to-end timeout discipline.

## Evidence

`src/core/viem/viem.service.ts:210-238`:

```typescript
async writeContract(
    chainId: number,
    privateKey: string,
    address: string,
    abi: readonly any[],
    functionName: string,
    args: any[] = [],
    options: ViemWriteContractOptions = {},
): Promise<Hash | TransactionReceipt> {
    const walletClient = this.getWalletClient(privateKey, chainId);
    const queueKey = `${chainId}-${walletClient.account.address}`;

    const pending = this.txQueues.get(queueKey) ?? Promise.resolve();
    const next = pending
        .catch(() => {})                 // ⚠️ swallows; never lets the queue advance on rejection
        .then(() =>
            this.executeWriteContract(
                walletClient,
                chainId,
                address,
                abi,
                functionName,
                args,
                options,
            ),
        );
    this.txQueues.set(queueKey, next);

    return next;
}
```

`executeWriteContract` (lines 281-285):

```typescript
if (options.waitForReceipt) {
    const publicClient = this.getPublicClient(chainId);
    this.logger.debug(`Waiting for transaction receipt: ${hash}`);
    return await publicClient.waitForTransactionReceipt({ hash });   // ⚠️ no timeout
}
```

viem's `waitForTransactionReceipt` polls indefinitely with no `timeout` argument supplied. Default polling interval is 4 s for HTTP transports; the function only resolves on receipt arrival or rejection from a transport-level error.

### Callers that pass `waitForReceipt: true`

- `withdraw.service.ts:148` — `Treasury.withdraw` (user-facing)
- `portfolio.service.ts:1037` — `withdrawLendPosition`
- `repay.service.ts:162` — `repay`
- `faucet.service.ts:373` — `faucet.mintBatch` (also user-facing per F-7, plus called by the bot worker)
- `orders.worker.ts:489` (sendTransaction with `waitForReceipt`-equivalent)

All of them serialize on the operator account.

### Queue swallow makes failure harmless to the queue but invisible to callers

```typescript
.catch(() => {})    // makes the queue advance even on prior rejection
```

The previous tx's rejection is hidden from the next `then`. Good for the queue's liveness in the *rejection* case. But if the previous tx **doesn't reject and doesn't resolve** (it hangs), the queue stays blocked. There's no "abort previous tx after T seconds" mechanism.

### No timeout cluster — same antipattern across modules

| Site | What | Default |
|------|------|---------|
| `viemService.writeContract` (`waitForReceipt: true`) | `publicClient.waitForTransactionReceipt({ hash })` | unbounded |
| `viemService.getTransactionReceipt` | `client.getTransactionReceipt({ hash })` | unbounded |
| `coingecko.provider.ts` | `fetch(url)` | undici default (long) |
| `database.service.ts` | `pg.Pool({ connectionString })` | no `statement_timeout` |

A request that touches any of these four can hang the request handler. Combined, they form a denial-of-service multiplier.

## Impact

### A. Operator queue stuck → all user writes block

1. User A calls `POST /withdraw` → backend awaits the operator's tx receipt.
2. Tx is underpriced after a baseFee spike (today: `(baseFee * 3n) / 2n + 1.5gwei`; if baseFee 5x's, the tx is now below market). Tx stays in mempool indefinitely.
3. User B calls `POST /portfolio/repay` → enqueued behind A's hung tx → also hangs.
4. User C calls `POST /faucet/request-tokens` (per F-7, no auth, no rate limit) → enqueued, hangs.
5. After ~N concurrent hung requests, Node's connection pool / DB pool / event-loop microtask queue all saturate.

In monitoring this looks like "the backend is up but every write 5-minutes-out". Restart the process to clear the queue; user writes resume; tx may eventually mine and the queued call sees the receipt — except that call is no longer alive.

### B. Process-restart-during-hang creates orphaned txs

Restart the backend mid-hang. The hash was logged but the receipt-wait was lost. The operator-signed tx may eventually mine (or not). DB state for whatever the call was supposed to do (decrement portfolio amount, write outbox row, etc.) was never written because the restart killed the post-receipt code path. Per F-25 / F-27, there's no transactional outbox to recover from this. **Funds move on chain; DB never reflects it.**

### C. Memory growth on hung txs

Each hung tx keeps:
- The `Promise<TransactionReceipt>` alive in `txQueues`.
- A polling timer alive in viem's transport.
- HTTP keepalive sockets to the RPC.
- Node closures over the original `args` / `walletClient`.

A few hundred hung txs across queues → tens of MB of retained memory; thousands → OOM eventually.

### D. Combined with other findings

- **F-2 (no rate limiter)**: an attacker doesn't need to wait for a baseFee spike — they spam `/faucet/request-tokens` and the operator queue grows linearly.
- **F-6 (`/deposit/confirm` accepts arbitrary txHash)**: each request hits `getTransactionReceipt` which has the same no-timeout pattern. 1000 concurrent confirm calls on bogus txHashes → 1000 polling loops.
- **F-44 (CoinGecko fetch hangs)**: user-facing endpoints that read prices behave the same — a slow CoinGecko hangs the borrow flow's HF check.
- **F-26 (operator key blast radius)**: the operator's queue is the protocol's queue. There's no graceful degradation for "operator slow."

## Recommended Solution

### 1. Bound `waitForReceipt` with a timeout

`src/core/viem/viem.service.ts`:

```typescript
private static readonly RECEIPT_TIMEOUT_MS = 60_000;

if (options.waitForReceipt) {
    return await publicClient.waitForTransactionReceipt({
        hash,
        timeout: ViemService.RECEIPT_TIMEOUT_MS,        // 🔒 60s ceiling
        pollingInterval: 2_000,
    });
}
```

If the receipt doesn't arrive in 60 s, viem rejects with `WaitForTransactionReceiptTimeoutError`. The queue advances. The caller gets a clean error and can retry / surface to the user.

For long-confirmation L1 chains, configure per-chain timeouts:

```typescript
private static readonly RECEIPT_TIMEOUT_BY_CHAIN: Record<number, number> = {
    1: 5 * 60_000,         // Ethereum mainnet
    421614: 60_000,        // Arbitrum Sepolia
    42161: 90_000,         // Arbitrum One
};
```

### 2. Detach receipt waiting from the queue (transactional outbox)

The queue's job is to serialize nonces. The receipt wait is async and shouldn't hold the queue:

```typescript
const next = pending
    .catch(() => {})
    .then(async () => {
        // Submit the tx and return the hash to the caller immediately.
        const hash = await this.submitOnly(walletClient, chainId, address, abi, functionName, args, options);

        // Hand off the receipt wait to a background job.
        this.scheduleReceiptApply(chainId, hash, () => {
            // Apply post-receipt state changes via outbox-style writeback.
        });

        return hash;
    });
```

Combined with F-25 / F-27 outbox recommendation, the post-receipt state change is durable and replayable.

### 3. Pre-flight gas-price check + bumping

If `baseFee * 3 / 2` is below market, the tx is going to hang. Don't submit:

```typescript
const block = await publicClient.getBlock({ blockTag: "latest" });
const baseFee = block.baseFeePerGas ?? 0n;

// Check pending mempool gas price (use eth_feeHistory or similar):
const feeHistory = await publicClient.request({ method: "eth_feeHistory", params: ["0x4", "latest", [50, 99]] });
const p99 = BigInt(feeHistory.reward[3][1] ?? "0x0");
if (maxFeePerGas < baseFee + p99) {
    throw new Error("Computed maxFeePerGas below network demand; refusing to submit");
}
```

Or implement RBF / nonce bumping after T seconds: if the tx hasn't mined, resubmit at a higher gas price and the same nonce.

### 4. Statement timeouts on the DB pool (also F-21)

```typescript
this.pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    statement_timeout: 5_000,
    query_timeout: 5_000,
    idle_in_transaction_session_timeout: 10_000,
});
```

Stops F-25 / F-38 long queries from holding a pool connection.

### 5. Fetch timeouts (also F-44)

`CoinGeckoProvider.fetchPrices`:

```typescript
const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
```

### 6. Unify under a `Timeouts` config block

```typescript
export const TIMEOUTS = {
    HTTP_FETCH_MS: 8_000,
    DB_QUERY_MS: 5_000,
    CHAIN_RECEIPT_MS: 60_000,
    CHAIN_RPC_CALL_MS: 10_000,
} as const;
```

Reference everywhere. CI lint to forbid new no-timeout `fetch(...)`, `waitForTransactionReceipt(...)`, etc.

```yaml
# .semgrep.yml
rules:
  - id: fetch-no-signal
    patterns:
      - pattern: fetch($URL)
      - pattern-not: fetch($URL, { ..., signal: $S, ... })
    message: "Pass an AbortSignal.timeout to fetch."
    languages: [typescript]
    severity: ERROR

  - id: wait-for-receipt-no-timeout
    patterns:
      - pattern: $C.waitForTransactionReceipt({ hash: $H })
    message: "Pass timeout: TIMEOUTS.CHAIN_RECEIPT_MS to waitForTransactionReceipt."
    languages: [typescript]
    severity: ERROR
```

### 7. Health endpoint surfaces queue depth

```typescript
@Get("health")
health() {
    const queueDepth = this.viemService.getQueueDepth();   // size of txQueues map + per-queue chain length
    return {
        ok: queueDepth < 10,
        queueDepth,
        oldestQueueAgeMs: this.viemService.getOldestQueueAge(),
    };
}
```

External monitoring alerts on `oldestQueueAgeMs > 60_000` — a hung tx is now an actionable signal, not silent.

### 8. Per-replica nonce isolation (operational, defense in depth)

If multiple backend replicas share the operator key (per F-26 not yet refactored), nonce races across replicas defeat the per-process queue. Either:

- Run only one replica (operationally fragile), or
- Use a remote signer / KMS service that owns the nonce (real fix; covered in F-26).

## Verification

```bash
# 1. Receipt timeout
# Mock viem's waitForTransactionReceipt to reject with a TimeoutError after 60s.
# Run a withdraw call. Expected: HTTP 500 (or 504) within 65s, not hung indefinitely.

# 2. Queue advance after hang
# Submit two withdraws back-to-back; mock the first to time out.
# Expected: first call rejects at T=60s; second call's tx submits at T=60s+ε.

# 3. Statement timeout
docker exec postgres psql -U centuari -d centuari -c "
    SET LOCAL statement_timeout = 5000;
    SELECT pg_sleep(10);
"
# Expected: ERROR: canceling statement due to statement timeout

# 4. CI gate
semgrep --config .semgrep.yml src/
# Expected: 0 violations after refactor.

# 5. Health endpoint
curl http://localhost:8080/health
# Expected: { ok: true, queueDepth: 0, oldestQueueAgeMs: 0 }

# Trigger a hang, then:
curl http://localhost:8080/health
# Expected: oldestQueueAgeMs > 60000 → external alert fires.
```

## References

- [viem: `waitForTransactionReceipt` `timeout` option](https://viem.sh/docs/actions/public/waitForTransactionReceipt.html#timeout-optional)
- [PostgreSQL: `statement_timeout`](https://www.postgresql.org/docs/current/runtime-config-client.html#GUC-STATEMENT-TIMEOUT)
- [Node.js `AbortSignal.timeout`](https://nodejs.org/api/globals.html#abortsignaltimeoutdelay)
- [CWE-833: Deadlock](https://cwe.mitre.org/data/definitions/833.html)
- [Replace-By-Fee (RBF) and stuck-tx patterns](https://blog.bitfly.at/2020/06/16/eip-1559-stuck-transactions-and-replace-by-fee/)
- See also F-2 (no rate limiter), F-21 (no statement timeout), F-25 / F-27 (outbox pattern), F-44 (fetch timeout), F-26 (operator key blast radius)
