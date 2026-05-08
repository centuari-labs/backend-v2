# F-20: `updateOrder` allows binding markets to a different asset

**Severity**: 🟠 High
**OWASP**: A01 Broken Access Control, A04 Insecure Design
**CWE**: CWE-841 (Improper Enforcement of Behavioral Workflow), CWE-345 (Insufficient Verification of Data Authenticity)

## Summary

`OrdersService.updateOrder` deletes all existing `order_markets` rows for the order and recreates them from `dto.marketIds` without verifying that the new markets belong to the same `asset_id` as the order. An authenticated user updating their own open order can re-route it to markets for an entirely different asset.

## Evidence

`src/orders/orders.service.ts:355-371`:

```typescript
order.quantity = newQuantityBaseUnits;
order.settlementFee = settlementFee;
order.rate = dto.rate;
order.autoRollover = dto.autoRollover ?? order.autoRollover;
order.status = filledQty > 0n ? OrderStatus.PartiallyFilled : OrderStatus.Open;

const updatedOrder = await orderRepo.save(order);

await orderMarketRepo.delete({ orderId });            // 🗑️ wipe old market links
for (const marketId of dto.marketIds) {                // ➕ recreate from user input
    await orderMarketRepo.save({
        orderId: updatedOrder.id,
        marketId,                                       // ⚠️ no check market.assetId === order.assetId
    });
}

const engineOrder = await this.buildMatchingEngineOrder(
    updatedOrder, { marketIds: dto.marketIds }, walletAddress
);
await this.natsService.publish(NATS_SUBJECTS.UPDATE, engineOrder);
```

`resolveMarketMaturities` only fetches `markets` by `id` — it does **not** verify the asset:

```typescript
private async resolveMarketMaturities(marketIds: string[]) {
    const marketEntities = await this.marketRepository.getMarketsByIds(marketIds);
    const maturityByMarketId = new Map<string, number>();
    for (const market of marketEntities) {
        maturityByMarketId.set(market.id, ...);
    }
    return maturityByMarketId;
}
```

`createLendLimitOrder` / `createBorrowLimitOrder` have the same gap on the create path (no asset/market consistency check), but it's especially exploitable on update because the `assetId` is locked from creation while `marketIds` can be swapped freely.

## Impact

- **F-20.1 — Cross-asset routing**: a user creates a USDC lend order, then updates it to point at WBTC markets. The matching engine receives an `assetId=USDC` order targeting WBTC markets — depending on engine semantics, this could match against borrowers expecting WBTC, leaving liquidity providers with the wrong asset.
- **F-20.2 — Settlement fee mismatch**: `computeSettlementFee` is computed against `order.assetId` (still USDC), but the markets the order routes through are for a different asset. The fee model and the executed market diverge.
- **F-20.3 — Health factor evasion**: borrow orders only re-check HF on amount change. An attacker can maintain the same amount, change `marketIds` to markets with a different collateral factor mix, and shift the effective LTV without HF recomputation.
- **F-20.4 — Combined with F-15/F-18 (websocket / NATS spoofing)**: forged events on a re-pointed order can confuse downstream cache state, since `assetId` and `markets` no longer correlate.

## Reproduction

```bash
USER=DEV_TOKEN_0x1111111111111111111111111111111111111111
ASSET_USDC=45474ad1-bcd7-4436-943e-e8850ea114f8
ASSET_WBTC=<wbtc asset id>
MARKET_WBTC_JUL=<wbtc market id>

# 1. Create lend order on USDC
ORDER_ID=$(curl -s -X POST http://localhost:8080/orders/lend/limit \
    -H "Authorization: Bearer $USER" \
    -d "{\"assetId\":\"$ASSET_USDC\",\"amount\":\"100\",\"marketIds\":[\"<usdc-market>\"],\"rate\":500}" \
    | jq -r '.data.id')

# 2. Update with marketIds belonging to a different asset
curl -X PUT "http://localhost:8080/orders/$ORDER_ID/update" \
    -H "Authorization: Bearer $USER" \
    -d "{\"amount\":\"100\",\"rate\":500,\"marketIds\":[\"$MARKET_WBTC_JUL\"]}"
# Expected (post-fix): 400 "marketIds must belong to assetId"
# Actual today: 200 with the WBTC market now bound to the USDC lend order
```

## Recommended Solution

### 1. Validate market ↔ asset consistency on every code path that ingests `marketIds`

`src/orders/orders.service.ts`:

```typescript
private async assertMarketsBelongToAsset(
    assetId: string,
    marketIds: string[],
): Promise<Map<string, number>> {
    const marketEntities = await this.marketRepository.getMarketsByIds(marketIds);

    if (marketEntities.length !== marketIds.length) {
        const found = new Set(marketEntities.map((m) => m.id));
        const missing = marketIds.filter((id) => !found.has(id));
        throw new BadRequestException(`Unknown market IDs: ${missing.join(", ")}`);
    }

    const wrongAsset = marketEntities.filter((m) => m.assetId !== assetId);
    if (wrongAsset.length > 0) {
        throw new BadRequestException(
            `Markets do not belong to asset ${assetId}: ${wrongAsset.map((m) => m.id).join(", ")}`,
        );
    }

    const maturityByMarketId = new Map<string, number>();
    for (const market of marketEntities) {
        maturityByMarketId.set(
            market.id,
            market.maturity ? Math.floor(market.maturity.getTime() / 1000) : 0,
        );
    }
    return maturityByMarketId;
}
```

Replace every existing call to `resolveMarketMaturities(marketIds)` with `assertMarketsBelongToAsset(assetId, marketIds)`. Affected sites:

- `prepareOrder` / `finalizeOrder` (create path) — line ~580
- `updateOrder` (line ~366)
- `buildMatchingEngineOrder` (line ~627)

### 2. Reject duplicate marketIds and cap the array

`src/orders/dto/create-order.dto.ts` and `update-order.dto.ts`:

```typescript
import { ArrayMaxSize, ArrayUnique } from "class-validator";

@IsArray()
@IsString({ each: true })
@IsUUID(undefined, { each: true })
@ArrayMinSize(1)
@ArrayMaxSize(20, { message: "At most 20 marketIds per order" })
@ArrayUnique({ message: "Duplicate marketIds not allowed" })
marketIds: string[];
```

### 3. Forbid changing markets after partial fill

If an order is partially filled, the original execution implied a routing choice. Allowing the user to re-point the remaining quantity to different markets changes the contract semantics under the matching engine's feet:

```typescript
if (filledQty > 0n) {
    const existingMarketIds = await orderMarketRepo
        .find({ where: { orderId } })
        .then((rows) => rows.map((r) => r.marketId).sort());
    const requestedSorted = [...dto.marketIds].sort();
    if (JSON.stringify(existingMarketIds) !== JSON.stringify(requestedSorted)) {
        throw new BadRequestException(
            "Cannot change markets on a partially filled order"
        );
    }
}
```

### 4. Re-check health factor on borrow updates whenever `marketIds` change

Even if amount is constant, switching to markets with different collateral-factor profiles changes the borrow's effective risk:

```typescript
if (order.side === OrderSide.Borrow) {
    const marketsChanged = !sameSet(existingMarketIds, dto.marketIds);
    const amountChanged = newQuantityBaseUnits !== order.quantity;
    if (marketsChanged || amountChanged) {
        // re-run health factor check (existing logic below)
    }
}
```

## Verification

```bash
# Negative test: cross-asset markets
curl -X PUT "http://localhost:8080/orders/$ORDER_ID/update" \
    -H "Authorization: Bearer $USER" \
    -d "{\"amount\":\"100\",\"rate\":500,\"marketIds\":[\"$MARKET_WBTC_JUL\"]}"
# Expected: 400 "Markets do not belong to asset ..."

# Negative test: duplicate markets
curl -X POST http://localhost:8080/orders/lend/limit \
    -H "Authorization: Bearer $USER" \
    -d "{\"assetId\":\"$ASSET_USDC\",\"amount\":\"100\",\"marketIds\":[\"$M1\",\"$M1\"],\"rate\":500}"
# Expected: 400 "Duplicate marketIds not allowed"

# Negative test: 100 markets
curl -X POST http://localhost:8080/orders/lend/limit \
    -H "Authorization: Bearer $USER" \
    -d "$(jq -nc --arg a "$ASSET_USDC" --argjson m "$(printf '%s\n' {1..100} | jq -R 'tostring' | jq -s '. | map(.)')" \
        '{"assetId":$a,"amount":"100","marketIds":$m,"rate":500}')"
# Expected: 400 "At most 20 marketIds per order"
```

## References

- [OWASP A01:2021 — Broken Access Control](https://owasp.org/Top10/A01_2021-Broken_Access_Control/)
- [CWE-841: Improper Enforcement of Behavioral Workflow](https://cwe.mitre.org/data/definitions/841.html)
