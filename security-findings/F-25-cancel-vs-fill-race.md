# F-25: `cancelOrder` runs without a transaction or row lock — races with the matching engine

**Severity**: 🔴 Critical (financial)
**OWASP**: A04 Insecure Design
**CWE**: CWE-362 (Concurrent Execution using Shared Resource), CWE-820 (Missing Synchronization)

## Summary

`OrdersService.cancelOrder` reads the order, mutates the in-memory entity, calls `repository.save`, and then publishes a NATS event — all outside a database transaction and without a row lock. The matching engine is a separate process that updates the same `orders` row when a match happens (status, `filled_quantity`, `remaining_quantity`).

If the matching engine fills the order between the cancel handler's read and write, the cancel write **overwrites the fill state** — leaving the DB with `status=Cancelled, filled_quantity=0` while the on-chain settlement for the partial fill has already executed. This is a textbook lost-update bug on a money-handling row.

## Evidence

`src/orders/orders.service.ts:229-262`:

```typescript
async cancelOrder(orderId: string, walletAddress: string): Promise<Order> {
    const order = await this.orderRepository.getOrderById(orderId);
    // ⚠️ no FOR UPDATE, no transaction

    if (!order) throw new NotFoundException(...);

    const account = await this.orderRepository.findAccountByWallet(walletAddress);
    if (!account || order.accountId !== account.id) {
        throw new ForbiddenException("You do not own this order");
    }

    const cancellableStatuses = [OrderStatus.Open, OrderStatus.PartiallyFilled];
    if (!cancellableStatuses.includes(order.status)) {
        throw new BadRequestException(...);
    }

    order.status = OrderStatus.Cancelled;
    order.cancelReason = CancelReason.UserCancelled;

    const updatedOrder = await this.orderRepository.save(order);   // ⚠️ overwrite without optimistic lock
    await this.publishCancelOrderToNats(orderId, walletAddress);   // ⚠️ NATS publish outside any DB tx
    return updatedOrder;
}
```

For comparison, `updateOrder` *is* wrapped in `this.dataSource.transaction(...)` (line 270). The asymmetry is part of the bug — `cancelOrder` is the more sensitive of the two operations and gets the weaker consistency. **Correction (added with [F-48](./F-48-update-order-lost-update-race.md))**: `updateOrder`'s transaction wrapper does not actually make it safe — at the default `READ COMMITTED` isolation level a transaction without a row lock still races. The same lost-update class lives there too; see F-48 for the dedicated finding.

`repository.save(entity)` in TypeORM produces a full UPDATE of every column, with no `WHERE status = :priorStatus` guard, so:

```sql
-- TypeORM emits something like:
UPDATE orders
   SET status='cancelled',
       cancel_reason='user_cancelled',
       remaining_quantity=<value-from-step-1>,
       filled_quantity=<value-from-step-1>,
       quantity=<value-from-step-1>,
       updated_at=NOW()
 WHERE id=<orderId>;
```

If the matching engine already wrote new `filled_quantity`/`remaining_quantity` values between read and write, the cancel UPDATE clobbers them.

## Impact

### Race timeline

```
t=0     User calls POST /orders/:id/cancel
t=0+a   cancelOrder reads:  { status: Open, filled: 0, remaining: 100 }
t=0+b   Matching engine matches 50 units of this order:
            - DB:  status=PartiallyFilled, filled=50, remaining=50
            - publishes orders.status to NATS
            - settlement engine fires the on-chain transfer for 50 units
t=0+c   cancelOrder writes (with stale entity):
            UPDATE orders SET status='cancelled', filled_quantity=0, remaining_quantity=100 ...
            ← clobbers the engine's write
t=0+d   publishCancelOrderToNats fires; engine removes order from book
t=0+e   `orders.status` event from earlier reaches the WS gateway, which has now-deleted/cancelled state
t=0+f   On-chain transfer for the 50 units lands; treasury has moved funds; DB doesn't reflect it
```

### Consequences

- **F-25.1 — Lost partial-fill state**: DB `filled_quantity` is reset to 0. Settlement was real. User's portfolio balance and the `matches` table are out of sync with `orders`.
- **F-25.2 — Double-spend on liquidity**: a lender places `100 USDC`, gets matched for `50`, cancels in the same window. DB now says lender's `100 USDC` is unlocked again — they can withdraw or re-lend it, on top of the `50` already on-chain in a borrower's hands.
- **F-25.3 — Audit trail gap**: `cancel_reason='user_cancelled'` masks that 50 units were matched. Forensic recovery requires reconstructing from `matches` and on-chain logs.
- **F-25.4 — Combined with F-15/F-18 (websocket / NATS spoof)**: a forged NATS `orders.status` mid-cancel can plant arbitrary `filled_quantity` that gets clobbered too — but the gateway broadcasts the spoofed value to clients before the clobber, creating a brief observable inconsistency.
- **F-25.5 — Worsened by the bot worker (`orders.worker.ts:cancelIfSpreadExceeded`)**: bots actively cancel orders in tight loops. Every spread-cancel goes through this same race.

## Reproduction (synthetic, since the matching engine is external)

```ts
// In a test that injects two parallel callers:
import { OrdersService } from "src/orders/orders.service";

it("cancel race overwrites a concurrent fill", async () => {
    const order = await ordersService.createLendLimitOrder({...}, wallet, userId);

    // Simulate matching-engine writing in parallel
    const enginePromise = (async () => {
        // Bypass service: write directly to the orders table to mimic the engine
        await dataSource.query(
            `UPDATE orders SET status='partially_filled', filled_quantity='50000000', remaining_quantity='50000000' WHERE id=$1`,
            [order.orderId],
        );
    })();

    // The race window is tiny but reproducible by reading first, awaiting engine, then saving.
    const userPromise = ordersService.cancelOrder(order.orderId, wallet);

    await Promise.all([enginePromise, userPromise]);

    const final = await dataSource.query(`SELECT status, filled_quantity FROM orders WHERE id=$1`, [order.orderId]);
    // Bug today:
    expect(final[0].status).toBe("cancelled");
    expect(final[0].filled_quantity).toBe("0");          // ⚠️ engine's write lost
});
```

Live: send a high-rate stream of cancel/place pairs while the matching engine is processing. Observed mismatch in `filled_quantity` between the `orders` row and the `matches` aggregate is the smoking gun.

## Recommended Solution

### 1. Wrap `cancelOrder` in a transaction with a row-level lock

```typescript
async cancelOrder(orderId: string, walletAddress: string): Promise<Order> {
    return this.dataSource.transaction(async (manager) => {
        const orderRepo = manager.getRepository(Order);

        // 🔒 SELECT ... FOR UPDATE — blocks the matching engine's UPDATE until our tx commits
        const order = await orderRepo
            .createQueryBuilder("order")
            .setLock("pessimistic_write")
            .where("order.id = :id", { id: orderId })
            .getOne();
        if (!order) throw new NotFoundException(`Order with ID ${orderId} not found`);

        const account = await this.orderRepository.findAccountByWallet(walletAddress);
        if (!account || order.accountId !== account.id) {
            throw new ForbiddenException("You do not own this order");
        }

        const cancellableStatuses = [OrderStatus.Open, OrderStatus.PartiallyFilled];
        if (!cancellableStatuses.includes(order.status)) {
            throw new BadRequestException(
                "Order can only be cancelled when status is open or partial",
            );
        }
        if (order.status === OrderStatus.Filled || order.status === OrderStatus.Cancelled) {
            throw new BadRequestException("Order is no longer active");
        }

        // Preserve filled_quantity / remaining_quantity from the locked read.
        order.status = OrderStatus.Cancelled;
        order.cancelReason = CancelReason.UserCancelled;
        const updated = await orderRepo.save(order);

        // Publish only after the tx commits — see point 3.
        manager.queryRunner!.afterCommit(() => {
            this.publishCancelOrderToNats(orderId, walletAddress).catch((e) =>
                this.logger.error(`NATS publish failed after cancel: ${e.message}`),
            );
        });

        return updated;
    });
}
```

The matching engine, if it also takes `FOR UPDATE` on the same row when filling (it should), will serialize against this. If it doesn't, see point 2.

### 2. Optimistic locking on `orders` (defense in depth)

Add a `version` column to `Order` and let TypeORM check it on `save`:

```typescript
// orders.entity.ts
@VersionColumn()
version: number;
```

Migration:
```sql
ALTER TABLE orders ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
```

Now `save` becomes:
```sql
UPDATE orders SET ..., version=version+1 WHERE id=$1 AND version=$2
```

If the engine wrote in between, the `WHERE version=$2` fails, save throws `OptimisticLockVersionMismatchError`, and we retry the cancel. No silent overwrite.

### 3. Don't publish to NATS until the DB transaction commits

Today the NATS publish is outside any transaction. If the publish succeeds but the transaction aborts (or vice versa), the engine and DB diverge. Use `afterCommit` (TypeORM `QueryRunner` hook), or capture the intended publish, commit the tx, then publish only on success.

```typescript
manager.queryRunner!.afterCommit(() => {
    this.publishCancelOrderToNats(orderId, walletAddress).catch((e) => ...);
});
```

For the broader pattern (reliable publish), use the **transactional outbox**: write the message to an `outbox` table inside the same tx, then a separate worker drains the outbox to NATS. This eliminates dual-write inconsistency entirely.

### 4. Make `repository.save` semantics explicit

Switch from `repository.save(entity)` to a targeted UPDATE that only touches the columns the cancel actually changes:

```typescript
await orderRepo.update(
    { id: orderId, status: In([OrderStatus.Open, OrderStatus.PartiallyFilled]) },
    {
        status: OrderStatus.Cancelled,
        cancelReason: CancelReason.UserCancelled,
    },
);
```

The `WHERE status IN (...)` clause is itself a guard against clobbering a `Filled` row even without the explicit lock.

### 5. Apply the same pattern to every place that mutates `orders`

```bash
$ grep -rn "orderRepository.save\|orderRepo\.save\|orderRepo\.update" src --include="*.ts" | grep -v test
```

For each hit, decide:
- Is it under a transaction? Lock the row?
- Does it use `repository.save` (full row update) when a partial UPDATE would do?

### 6. Reconciliation safety net

A periodic job that compares `orders.filled_quantity` against `SUM(matches.amount) FOR order_id`. Any drift gets logged and paged:

```sql
SELECT o.id, o.filled_quantity, COALESCE(SUM(m.amount), 0) AS sum_matches
FROM orders o
LEFT JOIN matches m ON m.order_id = o.id
GROUP BY o.id
HAVING o.filled_quantity::numeric != COALESCE(SUM(m.amount), 0);
```

Alerts on rows where the two disagree by more than a tolerance.

## Verification

```bash
# Reproduce the race in a test that bypasses the service to mimic the engine.
pnpm test src/__test__/orders/cancel-race.spec.ts
# Expected (post-fix): cancel either wins (engine sees Cancelled and rejects fill) or
# loses cleanly (cancel sees PartiallyFilled and rejects). Never silently overwrites.

# Live smoke test:
# 1. Run a tight loop of place→cancel for 60 seconds while the engine is matching.
# 2. After, run the reconciliation query above. Expected: 0 mismatches.
```

## References

- [PostgreSQL: Explicit Locking — `FOR UPDATE`](https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-ROWS)
- [TypeORM: Optimistic locking with `@VersionColumn`](https://orkhan.gitbook.io/typeorm/docs/transactions#how-to-use-versioning)
- [Microsoft: Transactional Outbox pattern](https://learn.microsoft.com/en-us/azure/architecture/best-practices/transactional-outbox)
- [CWE-362: Concurrent Execution using Shared Resource](https://cwe.mitre.org/data/definitions/362.html)
