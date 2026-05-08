# F-29: Order placement performs no balance check and never locks funds

**Severity**: 🔴 Critical (financial)
**OWASP**: A01 Broken Access Control, A04 Insecure Design
**CWE**: CWE-840 (Business Logic Errors), CWE-770 (Allocation of Resources Without Limits or Throttling)

## Summary

Lend order creation (`createLendMarketOrder`, `createLendLimitOrder`) never verifies that the user has enough free balance to back the order, and order creation across the board never increments `portfolio.locked_amount`. The `lockedAmount` column is queried in many places to compute "available balance," but **no code path in the backend writes to it**.

Borrow orders pass through `validateHealthFactor`, which gates on solvency — but it doesn't gate on whether collateral actually exists in the user's portfolio (an account with a `0` debt and `0` collateral has `HF = HEALTH_FACTOR_NO_DEBT`, see F-24). So borrow orders against an empty account also pass.

The result: any authenticated user can flood the system with arbitrarily-sized orders backed by no funds. The orders enter the matching engine, get matched, and only fail at on-chain settlement — by which time the protocol has burned operator gas, populated the `matches` table with phantom rows, and broadcast bad fills via the websocket gateway.

## Evidence

### `prepareOrder` — no balance check

`src/orders/orders.service.ts:377-412`:

```typescript
private async prepareOrder(
    dto: { assetId: string; amount: string },
    orderType: OrderType,
    walletAddress: string,
    privyUserId: string,
): Promise<PreparedOrderContext> {
    const accountId = await this.getOrCreateAccount(walletAddress, privyUserId);
    await this.tokensService.validateTokenByAssetId(dto.assetId);
    const decimals = await this.tokensService.getTokenDecimalsByAssetId(dto.assetId);
    if (decimals == null) throw new BadRequestException("Token decimals not configured");
    const quantityBaseUnits = humanToBaseUnits(dto.amount, decimals);
    const settlementFeeBaseUnits = await this.computeSettlementFee(...);
    const estimatedTradeFeeBaseUnits = this.computeEstimatedTradeFee(...);
    return { accountId, decimals, quantityBaseUnits, settlementFeeBaseUnits, estimatedTradeFeeBaseUnits };
    // ⚠️ no SELECT amount FROM portfolio WHERE account_id = $1 AND asset_id = $2
    // ⚠️ no comparison vs quantityBaseUnits
}
```

### `finalizeOrder` — no lock

`src/orders/orders.service.ts:460-502`:

```typescript
private async finalizeOrder(ctx, dto, orderParams, walletAddress, natsSubject): Promise<OrderResponse> {
    const order = this.orderRepository.create({
        accountId: ctx.accountId,
        assetId: dto.assetId,
        side: orderParams.side,
        type: orderParams.type,
        quantity: ctx.quantityBaseUnits,
        settlementFee: ctx.settlementFeeBaseUnits,
        status: OrderStatus.Open,
        rate: orderParams.rate,
        autoRollover: dto.autoRollover ?? false,
    });

    const savedOrder = await this.orderRepository.saveOrderWithMarkets(order, dto.marketIds ?? []);
    // ⚠️ saveOrderWithMarkets only inserts into orders + order_markets.
    //     No UPDATE portfolio SET locked_amount = locked_amount + quantity.

    const engineOrder = await this.buildMatchingEngineOrder(savedOrder, dto, walletAddress);
    await this.publishOrderToNats(natsSubject, engineOrder, ctx.accountId);
    return this.mapToResponse(...);
}
```

### `lockedAmount` is read but never written by backend code

```bash
$ grep -rnE "lockedAmount =|locked_amount =|UPDATE.*locked_amount|set.*lockedAmount" src --include="*.ts" \
    | grep -v "test\|spec\|select\|SELECT"
# Only matches are local variable assignments in withdraw/portfolio (reads), no UPDATEs.
```

The column is referenced for *display* in `getMyAssets`, `getMyPortfolio`, `getOpenOrders` — but it's never updated by the order flow. Either an external process (settlement engine) is supposed to write it, or this is a half-implemented feature.

### Borrow side has HF but no balance gate

`src/orders/orders.service.ts:434-462`:

```typescript
private async validateHealthFactor(accountId: string, dto: { assetId: string; amount: string }) {
    const assetPrice = await this.priceService.getPrice(dto.assetId);
    if (assetPrice == null || assetPrice <= 0) {
        throw new BadRequestException("Price not available for this asset");
    }
    const newOrderUsd = Number(dto.amount) * assetPrice;
    const hfResult = await this.portfolioService.getHealthFactorForAccount(accountId, {
        additionalBorrowUsd: newOrderUsd,
        includeOpenOrders: true,
    });
    // ⚠️ Number(dto.amount) — see F-16
    // ⚠️ HF check only — doesn't ensure any collateral row actually exists
}
```

Combined with **F-24** (missing-price = `0`, `totalDebtUsd = 0` → `HF = Infinity`): borrowing against an empty account passes the HF check for any debt token whose price is missing or stale.

## Impact

### Direct exploitation

**Spam phantom orders**: a single authenticated user (real or `DEV_TOKEN_…`) loops `POST /orders/lend/limit` with `amount: 999999999`. Backend accepts each, persists `orders` rows, publishes to NATS. Effects:

- DB blowup: unbounded rows in `orders` and `order_markets`.
- Matching engine compute spent matching unbacked orders.
- WS gateway broadcasts the orderbook including phantom liquidity. Other users see fake depth and may transact based on it.
- Operator gas spent when the matching engine attempts settlement.

**Phantom liquidity / market manipulation**: an attacker fills the orderbook with $1B lend orders at attractive rates. Borrowers see deep, low-rate liquidity. They place market borrows that match against the phantom orders. Settlement reverts on the user-token-transfer step — but the borrower's order is now `PartiallyFilled` in DB (per F-25 cancel race + race with status updates), borrower's HF reflects a borrow that didn't happen, and other users see the price impact.

**Front-running / liquidity-baiting**: combined with F-15 (WS leaks order data) and F-25 (cancel race), an attacker can place phantom liquidity, wait for a victim to place a market order against it, then cancel before settlement. The matched order is recorded as filled in DB (F-25 race window) before the cancel propagates. Net: attacker captures the market order's expected fill at the phantom rate without ever sourcing liquidity.

**Borrow-without-collateral**:

1. Attacker (new account) calls `POST /auth/login` with `DEV_TOKEN_0xATTACKER…`.
2. Pick a debt token whose `coingecko_id` is not set (or wait for the `~60 s` cold-start window — see F-24).
3. Call `POST /orders/borrow/limit` for that asset with any amount.
4. `validateHealthFactor`: price returns `null`/`0` → `Number(amount) * 0 = 0` → `additionalBorrowUsd = 0` → HF unchanged → check passes.
5. Order enters the book. If a counterparty fills, the borrower receives funds without ever depositing collateral.

### Combined effects

- F-24 closes some of this *if* prices are reliable; this finding closes the rest.
- F-25 + F-29 = cancellable phantom liquidity (worst case).
- F-26 = each unbacked order eventually consumes operator gas.
- F-29 + F-2 (no rate limit) = arbitrarily many phantom orders per second.

## Reproduction

```bash
TOK=DEV_TOKEN_0xattacker0000000000000000000000000000000
ASSET=<asset-uuid-with-no-portfolio-row-for-attacker>
MKT=<valid-market-id-for-asset>

# 1. Place a $1B lend order with $0 backing
curl -X POST http://localhost:8080/orders/lend/limit \
    -H "Authorization: Bearer $TOK" \
    -d "{\"assetId\":\"$ASSET\",\"amount\":\"1000000000\",\"marketIds\":[\"$MKT\"],\"rate\":500}"
# Expected today: 201 Created, orderId returned, NATS event published.
# Expected (post-fix): 400 "Insufficient balance".

# 2. Spam a thousand of these and watch the orderbook fill with fakes:
for i in $(seq 1 1000); do
    curl -s -X POST http://localhost:8080/orders/lend/limit \
        -H "Authorization: Bearer $TOK" \
        -d "{\"assetId\":\"$ASSET\",\"amount\":\"1000000\",\"marketIds\":[\"$MKT\"],\"rate\":$((400 + RANDOM % 200))}" \
        -o /dev/null &
done
wait

# 3. Confirm DB state
docker exec postgres psql -U centuari -d centuari -c \
    "SELECT count(*) FROM orders WHERE status='open' AND account_id=(
       SELECT id FROM accounts WHERE LOWER(user_wallet)='0xattacker0000000000000000000000000000000');"
# Expected today: ~1000.
# Expected (post-fix): 0.
```

## Recommended Solution

### 1. Pre-check available balance and lock atomically inside the same transaction

`src/orders/orders.service.ts`:

```typescript
private async finalizeLendOrder(
    ctx: PreparedOrderContext,
    dto: BaseCreateOrderDto,
    orderParams: { side: OrderSide.Lend; type: OrderType; rate: number },
    walletAddress: string,
    natsSubject: string,
): Promise<OrderResponse> {
    // Wrap order persistence + balance lock in a single transaction.
    return await this.dataSource.transaction(async (manager) => {
        const portfolioRepo = manager.getRepository(Portfolio);
        const orderRepo = manager.getRepository(Order);
        const orderMarketRepo = manager.getRepository(OrderMarket);

        // 🔒 Lock the portfolio row so concurrent orders see a consistent locked_amount.
        const row = await portfolioRepo
            .createQueryBuilder("p")
            .setLock("pessimistic_write")
            .where("p.account_id = :a AND p.asset_id = :id AND p.is_collateral = false", {
                a: ctx.accountId, id: dto.assetId,
            })
            .getOne();

        const available = row
            ? BigInt(row.amount) - BigInt(row.lockedAmount ?? "0")
            : 0n;
        const required = BigInt(ctx.quantityBaseUnits) + BigInt(ctx.settlementFeeBaseUnits);
        if (available < required) {
            throw new BadRequestException(
                `Insufficient balance: available ${available}, required ${required}`,
            );
        }

        // Increment lock atomically.
        if (row) {
            row.lockedAmount = (BigInt(row.lockedAmount ?? "0") + required).toString();
            await portfolioRepo.save(row);
        } else {
            // Should never happen because available was 0 and we threw above.
            throw new InternalServerErrorException("Portfolio row vanished");
        }

        // Persist order + markets.
        const order = orderRepo.create({
            accountId: ctx.accountId,
            assetId: dto.assetId,
            side: OrderSide.Lend,
            type: orderParams.type,
            quantity: ctx.quantityBaseUnits,
            settlementFee: ctx.settlementFeeBaseUnits,
            status: OrderStatus.Open,
            rate: orderParams.rate,
            autoRollover: dto.autoRollover ?? false,
        });
        const saved = await orderRepo.save(order);
        for (const marketId of dto.marketIds ?? []) {
            await orderMarketRepo.save({ orderId: saved.id, marketId });
        }

        // Publish to NATS only after the transaction commits — see F-25 outbox pattern.
        manager.queryRunner!.afterCommit(() => {
            const engineOrder = this.buildMatchingEngineOrderFromEntity(saved, dto, walletAddress);
            this.publishOrderToNats(natsSubject, engineOrder, ctx.accountId)
                .catch((e) => this.logger.error(`NATS publish failed: ${e.message}`));
        });

        return this.mapToResponse(saved, dto, walletAddress, ctx.estimatedTradeFeeBaseUnits);
    });
}
```

### 2. On `cancelOrder` and on terminal-status updates: decrement the lock symmetrically

```typescript
async cancelOrder(orderId: string, walletAddress: string): Promise<Order> {
    return this.dataSource.transaction(async (manager) => {
        const orderRepo = manager.getRepository(Order);
        const portfolioRepo = manager.getRepository(Portfolio);

        const order = await orderRepo
            .createQueryBuilder("o")
            .setLock("pessimistic_write")
            .where("o.id = :id", { id: orderId })
            .getOne();
        if (!order) throw new NotFoundException(...);
        // ... ownership check ...

        const released = BigInt(order.quantity)
            - BigInt(order.filledQuantity ?? "0")
            + BigInt(order.settlementFee);

        // Lock + decrement portfolio
        const portfolioRow = await portfolioRepo
            .createQueryBuilder("p")
            .setLock("pessimistic_write")
            .where("p.account_id = :a AND p.asset_id = :id AND p.is_collateral = false", {
                a: order.accountId, id: order.assetId,
            })
            .getOne();
        if (portfolioRow) {
            const current = BigInt(portfolioRow.lockedAmount ?? "0");
            portfolioRow.lockedAmount = (current >= released ? current - released : 0n).toString();
            await portfolioRepo.save(portfolioRow);
        }

        order.status = OrderStatus.Cancelled;
        order.cancelReason = CancelReason.UserCancelled;
        await orderRepo.save(order);

        manager.queryRunner!.afterCommit(() => {
            this.publishCancelOrderToNats(orderId, walletAddress).catch(...);
        });
        return order;
    });
}
```

### 3. Settlement-engine writeback path also needs to decrement on fill / settlement-revert

When a fill arrives via NATS (`orders.status`), the gateway / a backend listener should:

- On `Filled` / `PartiallyFilled` increment of `filled_quantity`: decrement `locked_amount` by the new fill quantity, and decrement `amount` by the same.
- On `settlement-revert` / failed-fill events: refund the lock (no change to `amount`).

This logic must be transactional and idempotent (key on `(orderId, fillId)`).

### 4. Borrow-side: also require a non-empty collateral row

`validateHealthFactor` is necessary but not sufficient. Add an explicit "must have non-zero collateral" gate when `dto.side === Borrow`:

```typescript
const hasCollateral = await this.portfolioRepository.hasAnyCollateral(accountId);
if (!hasCollateral) {
    throw new BadRequestException("No collateral posted for this account");
}
```

`hasAnyCollateral`:

```sql
SELECT EXISTS (
    SELECT 1 FROM portfolio p
    JOIN risk r ON r.asset_id = p.asset_id
    WHERE p.account_id = $1 AND p.is_collateral = true AND p.amount::numeric > 0 AND r.avg_lt > 0
) AS has;
```

Combined with the F-24 fix (reject missing prices instead of substituting 0), this closes the borrow-without-collateral path.

### 5. DB constraint as a safety net

```sql
ALTER TABLE portfolio ADD CONSTRAINT chk_locked_le_amount
    CHECK (locked_amount::numeric <= amount::numeric);
```

If anything tries to over-lock (logic bug, race), the DB rejects it.

### 6. Per-account cap on outstanding orders

Even with balance locks, allow a maximum of N open orders per account to prevent DoS via micro-orders:

```typescript
const openCount = await orderRepo.count({
    where: { accountId, status: In([OrderStatus.Open, OrderStatus.PartiallyFilled]) },
});
if (openCount >= 200) {
    throw new BadRequestException("Open-order limit reached (200). Cancel some orders first.");
}
```

## Verification

```bash
# 1. Place lend order with no portfolio balance — must reject
docker exec postgres psql -U centuari -d centuari -c \
    "DELETE FROM portfolio WHERE account_id=(SELECT id FROM accounts WHERE LOWER(user_wallet)='0xnoassets00000000000000000000000000000000');"

curl -X POST http://localhost:8080/orders/lend/limit \
    -H "Authorization: Bearer DEV_TOKEN_0xnoassets..." \
    -d "{\"assetId\":\"$ASSET\",\"amount\":\"1000\",\"marketIds\":[\"$MKT\"],\"rate\":500}"
# Expected: 400 "Insufficient balance".

# 2. Spam test — DB should not bloat
ATTACKER_ORDERS_BEFORE=$(docker exec postgres psql -U centuari -d centuari -tAc \
    "SELECT count(*) FROM orders WHERE account_id='...';")
for i in $(seq 1 100); do curl -X POST .../orders/lend/limit ... >/dev/null & done; wait
ATTACKER_ORDERS_AFTER=$(docker exec postgres psql -U centuari -d centuari -tAc \
    "SELECT count(*) FROM orders WHERE account_id='...';")
echo $((ATTACKER_ORDERS_AFTER - ATTACKER_ORDERS_BEFORE))
# Expected: 0 if no balance, ≤ N where N is the per-account open-order cap.

# 3. Concurrent place-place — locked_amount must equal sum
# (write a transaction-local race test in integration suite)

# 4. CHECK constraint
docker exec postgres psql -U centuari -d centuari -c \
    "UPDATE portfolio SET locked_amount = amount::numeric + 1 WHERE id = '...';"
# Expected: ERROR: new row for relation "portfolio" violates check constraint "chk_locked_le_amount"
```

## References

- [Compound Protocol: Account liquidity checks before borrow](https://docs.compound.finance/v2/comptroller/#account-liquidity)
- [DyDx Order book validation pre-NATS publish (architecture)](https://docs.dydx.community/dydx-governance/dydx-trading/protocol-architecture)
- [PostgreSQL: SELECT FOR UPDATE](https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE)
- [CWE-840: Business Logic Errors](https://cwe.mitre.org/data/definitions/840.html)
- Real-world: [Mango Markets oracle-manipulation $114M (2022)](https://rekt.news/mango-markets-rekt/) — order-book-without-balance-checks variant
