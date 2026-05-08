# F-48: `updateOrder` has the same lost-update race as `cancelOrder` — transaction wrapper doesn't help without a row lock

**Severity**: 🔴 Critical (financial)
**OWASP**: A04 Insecure Design
**CWE**: CWE-362 (Concurrent Execution using Shared Resource — Race Condition), CWE-820 (Missing Synchronization)

## Summary

[F-25](./F-25-cancel-vs-fill-race.md) called out that `cancelOrder` runs without a transaction or row lock and races the matching engine. While doing so, F-25 also said:

> For comparison, `updateOrder` *is* wrapped in `this.dataSource.transaction(...)` (line 270). The asymmetry is the bug — `cancelOrder` is the more sensitive of the two operations and gets the weaker consistency.

That comparison was wrong. `updateOrder` is wrapped in a transaction, but the transaction is only a multi-statement-atomicity boundary inside the backend. It doesn't take a row lock. The very first read inside the transaction is a plain `findOne` with no `pessimistic_write`. Between that read and the final `repository.save(order)` — which is a full-row UPDATE — the matching engine (a separate process) can write `filled_quantity` and `remaining_quantity` to the same `orders` row, and `save` will overwrite those writes back to whatever the entity has in memory.

This is a real lost-update on the same money-handling row F-25 covers, just dressed up by a transaction that gives a misleading impression of safety. Severity is the same as F-25 (critical, financial).

## Evidence

`src/orders/orders.service.ts:265-374`:

```typescript
async updateOrder(orderId: string, walletAddress: string, dto: UpdateOrderDto): Promise<Order> {
    return this.dataSource.transaction(async (manager) => {
        const orderRepo = manager.getRepository(Order);
        const orderMarketRepo = manager.getRepository(OrderMarket);

        const order = await orderRepo.findOne({ where: { id: orderId } });   // ⚠️ no setLock
        if (!order) throw new NotFoundException(...);

        // ... ownership, status, decimals, settlement-fee, HF checks, all using `order` ...

        order.quantity = newQuantityBaseUnits;
        order.settlementFee = settlementFee;
        order.rate = dto.rate;
        order.autoRollover = dto.autoRollover ?? order.autoRollover;
        order.status = filledQty > 0n ? OrderStatus.PartiallyFilled : OrderStatus.Open;

        const updatedOrder = await orderRepo.save(order);   // ⚠️ full-row UPDATE

        await orderMarketRepo.delete({ orderId });
        for (const marketId of dto.marketIds) {
            await orderMarketRepo.save({ orderId: updatedOrder.id, marketId });
        }

        const engineOrder = await this.buildMatchingEngineOrder(...);
        await this.natsService.publish(NATS_SUBJECTS.UPDATE, engineOrder);

        return updatedOrder;
    });
}
```

`grep -nE "setLock|FOR UPDATE" src/orders/orders.service.ts` returns nothing — no row lock anywhere in the file.

TypeORM's `save(entity)` translates to:

```sql
UPDATE orders
   SET status='open', quantity=$new, rate=$new, settlement_fee=$new,
       auto_rollover=$new, filled_quantity=$loaded, remaining_quantity=$loaded,
       cancel_reason=$loaded, ...
 WHERE id=$1;
```

`filled_quantity` and `remaining_quantity` are reset to whatever the entity holds — i.e. the value read at the start of the transaction.

## Impact

### Race timeline (matching engine running externally)

```
t=0     User POST /orders/:id/update
t=0+a   updateOrder reads:  { quantity: 100, filled: 0, remaining: 100, rate: 500 }
t=0+b   Matching engine matches 50 units of this order:
            UPDATE orders SET status='partially_filled', filled=50, remaining=50 WHERE id=$1;
            settlement engine fires the on-chain transfer for 50 units
t=0+c   User's HF check runs against `order` in memory (still { filled: 0 }) — passes
t=0+d   Service mutates order entity: quantity=$newQuantity, rate=$newRate, ...
t=0+e   orderRepo.save(order) emits an UPDATE clobbering filled_quantity=50 back to 0
        (because the in-memory entity hasn't seen the engine's write).
t=0+f   updatedOrder is published to NATS as a fresh "open" order.
t=0+g   Settlement for the 50-unit fill lands. DB shows fill=0 and a different quantity/rate.
```

### Consequences

- **F-48.1 — Lost partial-fill state**: identical to F-25 outcome. DB `filled_quantity` reset to 0; on-chain settlement happened anyway. Treasury moved funds, ledger doesn't reflect it.
- **F-48.2 — Stale entity drives downstream decisions**: the borrow-side HF check uses `order.amount` and `dto.amount` to compute new exposure, but the *actual* exposure on the book includes the matching engine's recently-decremented remaining quantity. The HF assertion is computed against an out-of-date view.
- **F-48.3 — `auto_rollover` flip mid-fill**: a user toggling `autoRollover` while the engine is filling may end up with an order whose remaining quantity is 0 (filled) but DB shows partial filled and `autoRollover=true`. Auto-rollover semantics on a fully-settled order are ambiguous.
- **F-48.4 — `orderMarketRepo.delete + recreate` adds another race surface**: F-20 already covers cross-asset market binding via `dto.marketIds`. F-48 stacks on top of that — even if the new markets are valid, the delete-recreate sequence inside the unsynchronized transaction window means a fill that lands during the delete can reference a market row that's gone in the next millisecond.
- **F-48.5 — F-25 + F-48 together = both money-mutation paths leak**: cancel and update are the only two user-driven order writes. Both have lost-update races; F-25 fix doesn't close F-48; the F-25 fix template (`setLock("pessimistic_write")`) is exactly what's needed here too.

### Why F-25's "the transaction makes it safe" was wrong

A DB transaction in PostgreSQL gives:

- **Atomicity** of the multi-statement bundle (all-or-nothing).
- **Isolation** at the DEFAULT `READ COMMITTED` level — meaning the transaction sees committed data, but **not** snapshot-from-tx-start data.

`READ COMMITTED` does not prevent a concurrent transaction from committing a write to the same row between this transaction's read and write. The only way to prevent that is:

1. `SELECT ... FOR UPDATE` (pessimistic write lock), or
2. `REPEATABLE READ` / `SERIALIZABLE` isolation (with retry on serialization failure), or
3. Optimistic locking with a `@VersionColumn`.

`updateOrder` does none of these.

## Reproduction

```typescript
// In a test that injects two parallel writers (the engine simulated by raw SQL):
it("updateOrder loses concurrent fill", async () => {
    const order = await ordersService.createLendLimitOrder({...}, wallet, userId);

    // Race the engine
    const enginePromise = (async () => {
        await new Promise((r) => setTimeout(r, 5));   // let the user's tx start
        await dataSource.query(
            `UPDATE orders SET status='partially_filled', filled_quantity=50, remaining_quantity=50 WHERE id=$1`,
            [order.orderId],
        );
    })();

    const userPromise = ordersService.updateOrder(order.orderId, wallet, {
        amount: "200", rate: 600, marketIds: order.marketIds,
    });

    await Promise.all([enginePromise, userPromise]);

    const final = await dataSource.query(
        `SELECT status, filled_quantity, remaining_quantity, rate, quantity FROM orders WHERE id=$1`,
        [order.orderId],
    );
    // Bug today:
    expect(final[0].filled_quantity).toBe("0");          // ⚠️ engine's 50 is lost
    expect(final[0].remaining_quantity).toBe("..."); // whatever the in-memory entity had
    expect(final[0].rate).toBe(600);                  // user's update applied
});
```

## Recommended Solution

The fix is the same shape as F-25's. Apply it here too.

### 1. Pessimistic row lock at the start of the transaction

`src/orders/orders.service.ts`:

```typescript
async updateOrder(orderId: string, walletAddress: string, dto: UpdateOrderDto): Promise<Order> {
    return this.dataSource.transaction(async (manager) => {
        const orderRepo = manager.getRepository(Order);
        const orderMarketRepo = manager.getRepository(OrderMarket);

        // 🔒 SELECT ... FOR UPDATE — blocks the matching engine's UPDATE on this row
        //    until our tx commits.
        const order = await orderRepo
            .createQueryBuilder("order")
            .setLock("pessimistic_write")
            .where("order.id = :id", { id: orderId })
            .getOne();
        if (!order) throw new NotFoundException(`Order with ID ${orderId} not found`);

        // The rest of the method stays the same — but `order.filled_quantity` and
        // `order.remaining_quantity` are now stable for the duration of the tx.
        const account = await this.orderRepository.findAccountByWallet(walletAddress);
        if (!account || order.accountId !== account.id) {
            throw new ForbiddenException("You do not own this order");
        }
        // ... existing checks ...

        // Use a partial UPDATE so we don't clobber columns we didn't intend to touch.
        await orderRepo.update(
            { id: orderId, status: In([OrderStatus.Open, OrderStatus.PartiallyFilled]) },
            {
                quantity: newQuantityBaseUnits,
                settlementFee,
                rate: dto.rate,
                autoRollover: dto.autoRollover ?? order.autoRollover,
                status: filledQty > 0n ? OrderStatus.PartiallyFilled : OrderStatus.Open,
            },
        );

        // Reload to get the engine-written columns intact.
        const reloaded = await orderRepo.findOneByOrFail({ id: orderId });

        await orderMarketRepo.delete({ orderId });
        for (const marketId of dto.marketIds) {
            await orderMarketRepo.save({ orderId: reloaded.id, marketId });
        }

        // Publish only after commit — see F-25 §3 (transactional outbox / afterCommit hook).
        manager.queryRunner!.afterCommit(() => {
            const engineOrder = this.buildMatchingEngineOrderFromEntity(reloaded, dto, walletAddress);
            this.natsService.publish(NATS_SUBJECTS.UPDATE, engineOrder).catch((e) =>
                this.logger.error(`NATS publish failed after update: ${e.message}`),
            );
        });

        return reloaded;
    });
}
```

The two key shape changes are:

- `setLock("pessimistic_write")` on the read.
- `repo.update(criteria, partial)` instead of `repo.save(entity)`, scoped to the columns the user is changing. Eliminates the full-row clobber.

Combined, they make the transaction's READ COMMITTED isolation actually safe for this workflow.

### 2. Optimistic-lock fallback (defense in depth, also F-25 §2)

Add a `@VersionColumn` to `Order`:

```typescript
@VersionColumn()
version: number;
```

Migration:

```sql
ALTER TABLE orders ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
```

If the team prefers to keep `repo.save(entity)`, version-bumping makes the bad write fail loudly with `OptimisticLockVersionMismatchError` instead of silently clobbering. Pair with a retry loop that re-reads, re-validates, and re-saves.

### 3. Status-guarded UPDATE clause (also F-25 §4)

The `criteria` argument in step 1's `repo.update` includes `status: In([Open, PartiallyFilled])`. If the matching engine has already moved the order to `Filled` between the locked read and the write, the WHERE clause matches zero rows and the update is a no-op — let it surface as a clean error rather than silently overwriting a `Filled` row.

```typescript
const updateResult = await orderRepo.update(
    { id: orderId, status: In([OrderStatus.Open, OrderStatus.PartiallyFilled]) },
    { ... },
);
if (updateResult.affected === 0) {
    throw new BadRequestException("Order is no longer active; refresh and retry.");
}
```

### 4. Audit every other `repository.save(entity)` after a non-locking read

```bash
$ grep -rnE "repo\.save\(|repository\.save\(|\.save\(order\)|\.save\(account\)|\.save\(portfolio" \
    src --include="*.ts" | grep -v "test\|spec\|migration"
```

For each hit:

- Is the read locked?
- Does `save` clobber columns the read didn't see?
- Is there an external writer (matching engine, settlement engine, indexer) that touches the same row?

Likely candidates beyond `cancelOrder` (F-25) and `updateOrder` (F-48):

- `withdrawLendPosition` and `repay` — already covered by F-27.
- `accounts` upsert in `getOrCreateAccount` — F-36 covers.
- `portfolio` rows in withdraw — covered by F-16 / F-29's locking recommendation.

The lesson is the same in every spot: **a transaction without a row lock is not isolation; it's just multi-statement atomicity.**

## Verification

```ts
// Race test (mirrors F-25's verification)
await Promise.all([
    ordersService.updateOrder(orderId, wallet, { amount: "200", rate: 600, marketIds }),
    dataSource.query(`UPDATE orders SET filled_quantity=50, remaining_quantity=50 WHERE id=$1`, [orderId]),
]);

const row = await dataSource.query(
    `SELECT status, filled_quantity, remaining_quantity, rate FROM orders WHERE id=$1`,
    [orderId],
);
// Expected (post-fix): exactly one of:
//   (a) update wins — filled=50, rate=600 (engine's update happens after the lock releases), or
//   (b) update fails with "Order is no longer active" if the engine moved it past PartiallyFilled.
// Today: filled=0 (engine's fill is lost).
```

CI gate:

```yaml
# .semgrep.yml
rules:
  - id: typeorm-save-without-prior-lock
    message: "repository.save(entity) after a non-locking findOne is racy. Use setLock('pessimistic_write') or repo.update(criteria, partial)."
    languages: [typescript]
    pattern-either:
      - pattern: |
          $REPO.findOne(...);
          ...
          $REPO.save(...);
      - pattern: |
          await $REPO.findOne(...);
          ...
          await $REPO.save(...);
    severity: WARNING
```

Tunable; the team may want to whitelist specific known-safe locations.

## References

- [PostgreSQL: Transaction Isolation — READ COMMITTED](https://www.postgresql.org/docs/current/transaction-iso.html#XACT-READ-COMMITTED)
- [PostgreSQL: SELECT FOR UPDATE](https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE)
- [TypeORM: Pessimistic locking](https://typeorm.io/select-query-builder#using-locking)
- [TypeORM: `@VersionColumn` (optimistic)](https://orkhan.gitbook.io/typeorm/docs/transactions#how-to-use-versioning)
- [F-25](./F-25-cancel-vs-fill-race.md) — sibling finding on `cancelOrder`. F-25 §1 / §2 / §3 templates apply directly here.
- [CWE-362](https://cwe.mitre.org/data/definitions/362.html), [CWE-820](https://cwe.mitre.org/data/definitions/820.html)
