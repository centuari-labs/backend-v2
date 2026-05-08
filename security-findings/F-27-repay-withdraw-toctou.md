# F-27: `repay` and `withdrawLendPosition` are not transactional — chain & DB can desync

**Severity**: 🟠 High (financial)
**OWASP**: A04 Insecure Design, A08 Software & Data Integrity
**CWE**: CWE-362 (Concurrent Execution using Shared Resource), CWE-820 (Missing Synchronization), CWE-460 (Improper Cleanup on Thrown Exception)

## Summary

`RepayService.repay` and `PortfolioService.withdrawLendPosition` interleave DB reads, on-chain writes, and DB writes without a wrapping transaction or row lock. Five separate failure modes follow:

1. **Concurrent repay** — two requests read the same `total_debt`, both compute their `repayAmountBaseUnits` against the full debt, both fire on-chain repays. The second one will revert (or partially repay), but DB updates double-debit either way.
2. **On-chain success + DB write failure** — the repay transaction lands, then `updateDatabaseState` throws (network blip, constraint violation, etc.). On-chain debt is reduced, DB still shows full debt. User can retry repay → double-pay.
3. **DB write success + on-chain revert** — opposite direction. Less likely (we await the receipt) but possible if the receipt assertion is loosened later.
4. **Stale `getOnChainDebt` read** — read between submit-tx and mine-tx of a competing repay results in a "synced to zero" path firing on a position that is in fact only partly repaid.
5. **`getOrCreateAccount` side-effect on a read+write path** — both methods call it, creating an empty account row if the wallet isn't known. Unrelated to the TOCTOU but signals broader hygiene issues in this code.

## Evidence

### `repay`

`src/portfolio/repay.service.ts:36-115`:

```typescript
async repay(dto, walletAddress, privyUserId) {
    const { marketId, amount } = dto;

    const accountId = await this.orderRepository
        .getOrCreateAccount(walletAddress, privyUserId)        // ⚠️ side-effect on read path
        .then((a) => a.id);

    const market = await this.repayRepository.getMarketWithAsset(marketId);
    const totalDebtStr = await this.repayRepository.getUserTotalDebt(accountId, marketId);  // ① read
    const totalDebt = BigInt(totalDebtStr);

    const repayAmountBaseUnits = this.parseRepayAmount(amount, market.decimals ?? 18, totalDebt);

    const onChainDebt = await this.getOnChainDebt(marketIdBytes32, walletAddress);   // ② read

    if (onChainDebt === 0n && totalDebt > 0n) {
        await this.syncAllPositionsToZero(...);
        throw new BadRequestException("This position has already been fully repaid.");
    }

    const txHash = await this.executeBlockchainRepay(...);     // ③ on-chain write (signs with operator)
    await this.updateDatabaseState(repayAmountBaseUnits, txHash, ...);  // ④ DB write
    return { txHash, status: "success" };
}
```

No `dataSource.transaction(...)`. No `SELECT ... FOR UPDATE`. Steps ①–④ can be interleaved with another caller's identical sequence on the same `(account, market)` pair.

### `withdrawLendPosition`

`src/portfolio/portfolio.service.ts:949-1026` follows the same shape: read positions, read market, on-chain write (operator-signed), DB write. No transaction.

### `repay`'s `Number(amount)` validator

`parseRepayAmount`:

```typescript
const amountNum = Number(amount);
if (Number.isNaN(amountNum) || amountNum <= 0) {
    throw new BadRequestException("Invalid repay amount");
}
// ... then parseUnits(amount, decimals) — saved by parseUnits' own validation
```

`Number("Infinity") = Infinity`; `Infinity <= 0` is `false`; the check passes; `parseUnits("Infinity", ...)` throws — caught by the outer try/catch which converts it to a generic 400. This is dependency-on-downstream-validation, not real input validation.

## Impact

### Concrete scenarios

**S1 — Double repay via concurrency.** Two browser tabs (or two attacker requests) both POST `/portfolio/repay` for the same market in the same second:
- Both read `totalDebt = 100` from DB.
- Both `parseRepayAmount("100", ...)` → `100`.
- Both call `executeBlockchainRepay(100)`.
- The on-chain contract revert/processes one or the other; assume only one mines.
- Both attempt `updateDatabaseState(100, ...)`.
- Best case: DB now has `total_debt = 0` (correct after first), or `-100` (after second decrement).
- Worst case: tx logs duplicated, position rows written twice, future `repay` calls confused.

**S2 — On-chain repay succeeds, DB write fails.**
- `executeBlockchainRepay` returns a txHash.
- `updateDatabaseState` throws (e.g. position row deleted by another request between read and write, or DB pool exhausted).
- User retries repay. DB still shows full debt. User pays a second time.
- Net loss: 1× repay amount (paid twice).

**S3 — `getOnChainDebt` read race with another repay.**
- User A submits repay. tx is in mempool.
- User B (or A's other tab) submits another repay.
- `getOnChainDebt` for B is read while A's tx is pending. Returns A's pre-repay debt.
- B's repay then races A's: contract may revert or partially process.
- DB sync logic for B may fire `syncAllPositionsToZero` based on a stale read.

**S4 — `withdrawLendPosition` similar pattern.** Two concurrent calls on the same matured position both compute `totalShares = X`, both call `executeBlockchainWithdraw(X)`. Whichever lands second reverts; DB updates may both run with stale row data.

### Dependency on F-26 + F-25

The operator (per F-26) signs every on-chain action. Every TOCTOU here is also an operator-signed mistake on chain. The cancel race in F-25 is the same family — different code path, same root cause (no transaction or lock).

## Recommended Solution

### 1. Wrap each method in a transaction with row-level locks

`src/portfolio/repay.service.ts`:

```typescript
async repay(dto: RepayRequestDto, walletAddress: string, privyUserId: string): Promise<RepayResponseDto> {
    const { marketId, amount } = dto;

    return this.dataSource.transaction(async (manager) => {
        const account = await this.orderRepository.findAccountByWallet(walletAddress);
        if (!account) throw new NotFoundException("Account not found");
        const accountId = account.id;

        // 🔒 Lock the borrow positions for this (account, market) before reading total debt.
        const positions = await manager
            .getRepository(BorrowPosition)
            .createQueryBuilder("bp")
            .setLock("pessimistic_write")
            .where("bp.account_id = :a AND bp.market_id = :m", { a: accountId, m: marketId })
            .getMany();

        const totalDebt = positions.reduce(
            (acc, p) => acc + BigInt(p.borrowedAmount ?? "0"),
            0n,
        );
        if (totalDebt <= 0n) {
            throw new NotFoundException("No active borrow positions found");
        }

        const market = await this.repayRepository.getMarketWithAsset(marketId);
        const repayAmountBaseUnits = this.parseRepayAmount(amount, market.decimals ?? 18, totalDebt);

        // On-chain pre-check stays useful (it catches divergence between DB and chain),
        // but the source of truth for "what to settle" is the locked DB read above.
        const marketIdBytes32 = uuidToBytes32(marketId);
        const onChainDebt = await this.getOnChainDebt(marketIdBytes32, walletAddress);
        if (onChainDebt === 0n) {
            // Database thought there was debt; on-chain says no. Sync within the same tx.
            await this.syncAllPositionsToZero(/* manager-aware */ accountId, marketId, walletAddress, market.assetId, market.tokenAddress, manager);
            throw new BadRequestException("This position has already been fully repaid.");
        }

        // Signed by operator; this is the externally-visible write.
        const txHash = await this.executeBlockchainRepay(
            marketIdBytes32, walletAddress, market.tokenAddress, repayAmountBaseUnits,
        );

        // Update DB inside the same transaction. If this throws, the transaction rolls back —
        // but the on-chain tx is already mined, so we use the outbox pattern below (point 3).
        await this.updateDatabaseState(
            repayAmountBaseUnits, txHash, accountId, marketId, walletAddress,
            market.assetId, market.tokenAddress, manager,
        );

        return { txHash, status: "success" };
    });
}
```

Apply the same shape to `withdrawLendPosition`.

### 2. Don't call on-chain inside the transaction

A long-running on-chain call inside a DB transaction holds the row lock for the duration of `waitForReceipt` — could be tens of seconds on Arbitrum, locking out every concurrent repay for that user. Two-phase pattern:

1. Tx 1: lock rows, compute amount, write a `pending_repay` row keyed by an idempotency token, commit.
2. Issue on-chain tx using the idempotency token as a deterministic nonce-of-intent.
3. Tx 2: on receipt, lock rows again, settle DB state, mark `pending_repay` as completed.

This is the standard "saga" pattern for a chain-DB hybrid system. It keeps the row lock window short and provides a place to retry if step 2 or 3 fails.

### 3. Transactional outbox for chain calls

Instead of "DB → chain → DB", write the **intended chain action** to an `outbox` row inside the locking transaction. A worker reads the outbox, sends the tx, and on receipt writes back the result row in another locking transaction. If anything blows up between the two, the outbox row is the recovery anchor.

Schema:

```sql
CREATE TABLE chain_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind TEXT NOT NULL,           -- 'repay' | 'withdraw' | 'lend_withdraw'
    payload JSONB NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'submitted' | 'mined' | 'failed'
    tx_hash TEXT,
    submitted_at TIMESTAMPTZ,
    mined_at TIMESTAMPTZ,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_outbox_pending ON chain_outbox (status, created_at) WHERE status = 'pending';
```

Worker:

```typescript
@Interval(2000)
async drainOutbox() {
    const next = await this.db.query<{ id: string }>(
        `SELECT id FROM chain_outbox WHERE status='pending' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`
    );
    if (next.length === 0) return;
    const row = await this.db.queryOne(`SELECT * FROM chain_outbox WHERE id=$1`, [next[0].id]);
    try {
        const txHash = await this.viemService.writeContract(...payload from row);
        await this.db.query(
            `UPDATE chain_outbox SET status='submitted', tx_hash=$1, submitted_at=NOW() WHERE id=$2`,
            [txHash, row.id],
        );
        const receipt = await this.viemService.waitForReceipt(txHash);
        await this.applyReceiptToState(row, receipt);   // does its own locking transaction
    } catch (err) {
        await this.db.query(
            `UPDATE chain_outbox SET status='failed', error=$1 WHERE id=$2`,
            [(err as Error).message, row.id],
        );
    }
}
```

The user-facing `repay` endpoint just enqueues an outbox row inside the user's locking transaction and returns 202 with the idempotency key. Frontend polls `/repay/:idempotencyKey/status`.

### 4. Idempotency keys

Each user-initiated `repay` / `withdraw` request should carry an idempotency key (header `Idempotency-Key`). Backend dedups in the outbox by `(walletAddress, idempotencyKey)`. A retried request with the same key returns the previous result rather than firing a second on-chain tx.

```typescript
@Post("repay")
async repay(
    @Body() dto: RepayRequestDto,
    @Wallet() walletAddress: string,
    @CurrentUser() user: { userId: string },
    @Headers("idempotency-key") idempotencyKey: string,
) {
    if (!idempotencyKey || idempotencyKey.length > 64) {
        throw new BadRequestException("Idempotency-Key header required (≤ 64 chars)");
    }
    return this.repayService.repay(dto, walletAddress, user.userId, idempotencyKey);
}
```

### 5. Stricter input validation

Replace the `Number(amount)`-then-`parseUnits` chain with a single call that validates against the DTO's `IsPositiveNumericString` + `IsMinAmount` (already in the validator library — apply to `RepayRequestDto.amount` per F-17).

```typescript
// repay.dto.ts
@IsString()
@IsNotEmpty()
@MaxLength(30)
@IsPositiveNumericString()
amount: string;
```

Then parseRepayAmount can drop the `Number(amount)` line entirely.

### 6. Reconciliation job

Independent of normal flow, a periodic job:

```sql
SELECT bp.account_id, bp.market_id, SUM(bp.borrowed_amount) AS db_debt
FROM borrow_positions bp
GROUP BY bp.account_id, bp.market_id
HAVING SUM(bp.borrowed_amount) > 0;
```

For each row, query on-chain `borrow(marketId, account.user_wallet)`. If the two diverge by more than a configurable tolerance, page the on-call.

## Verification

```typescript
// Concurrency test
await Promise.all([
    repayService.repay({ marketId, amount: "100" }, wallet, userId, "key-1"),
    repayService.repay({ marketId, amount: "100" }, wallet, userId, "key-2"),
]);
// Expected (post-fix): one succeeds, one throws BadRequest "amount exceeds total debt".
// Today: both submit on-chain.

// Idempotency test
const first = await repayService.repay({ marketId, amount: "50" }, wallet, userId, "abc");
const second = await repayService.repay({ marketId, amount: "50" }, wallet, userId, "abc");
expect(first.txHash).toBe(second.txHash);
// On-chain: only one tx.

// Reconciliation
await runReconciliationJob();
// Expected: 0 mismatches.
```

## References

- [Saga pattern — microservices.io](https://microservices.io/patterns/data/saga.html)
- [Microsoft: Transactional Outbox](https://learn.microsoft.com/en-us/azure/architecture/best-practices/transactional-outbox)
- [Stripe API: Idempotency keys](https://stripe.com/docs/api/idempotent_requests)
- [PostgreSQL: SKIP LOCKED for queue patterns](https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE)
- [CWE-362](https://cwe.mitre.org/data/definitions/362.html), [CWE-460](https://cwe.mitre.org/data/definitions/460.html)
