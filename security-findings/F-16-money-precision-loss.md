# F-16: Token amount handling uses JS `Number` — precision loss on money paths

**Severity**: 🔴 Critical (financial)
**OWASP**: A04 Insecure Design
**CWE**: CWE-681 (Incorrect Conversion between Numeric Types), CWE-682 (Incorrect Calculation)

## Summary

Withdraw, repay, and order-worker code paths convert string-encoded base-unit token amounts into JavaScript `Number` and perform arithmetic and comparisons on the result. JavaScript's `Number` is an IEEE-754 double — precision is lost above `Number.MAX_SAFE_INTEGER` (`2^53 - 1` ≈ `9.007e15`).

For an 18-decimal token (ETH, most ERC-20s), `1 token = 1e18 base units` already exceeds the safe range. **Comparisons and deductions on these amounts are not reliable**, opening the door to balance-rounding exploits and incorrect debits.

## Evidence

### Withdraw — base-unit amount converted to Number

`src/withdraw/withdraw.service.ts:42-110`:

```typescript
async withdraw(dto: WithdrawRequestDto, walletAddress: string) {
    const { assetId, amount } = dto;

    const amountNum = Number(amount);                    // ⚠️ "5e30" → Infinity passes <= 0 check
    if (Number.isNaN(amountNum) || amountNum <= 0) {
        throw new BadRequestException("Amount must be a positive number");
    }

    // ...
    const amountInBaseStr = humanToBaseUnits(amount, decimals);  // string, BigInt-safe
    const amountBaseNum = Number(amountInBaseStr);               // ⚠️ precision loss above 2^53

    // Locked rows fetched, then:
    const nonCollateralAmount = nonCollateralRow ? Number(nonCollateralRow.amount) : 0;  // ⚠️
    const collateralAmount = collateralRow ? Number(collateralRow.amount) : 0;            // ⚠️
    const lockedAmount = nonCollateralRow ? Number(nonCollateralRow.lockedAmount ?? 0) : 0;
    const totalAvailable = nonCollateralAmount + collateralAmount - lockedAmount;          // ⚠️

    if (amountBaseNum > totalAvailable) {                       // ⚠️ comparison on lossy doubles
        throw new BadRequestException(`Insufficient balance...`);
    }

    const nonCollateralDeduction = Math.min(amountBaseNum, nonCollateralAmount);  // ⚠️
    const collateralDeduction = amountBaseNum - nonCollateralDeduction;            // ⚠️
    // ... debits applied with Number math
}
```

### Repay — same pattern

`src/portfolio/repay.service.ts:127`:
```typescript
const amountNum = Number(amount);
```

### Order worker — USD value computed with Number

`src/orders/orders.worker.ts`:
```typescript
const halvedAmount = (Number(amount) / 2).toFixed(2);   // line 908
const newOrderUsd = Number(amount) * assetPrice;        // line 1072
```

### Demonstration

```javascript
// 100.5 ETH in 18-decimal base units:
const a = "100500000000000000000";   // 1.005e20
const b = "100500000000000000001";   // 1 wei more
console.log(Number(a) === Number(b));   // true   ⚠️ identical after conversion
console.log(Number(a) > Number.MAX_SAFE_INTEGER);   // true

// Off-by-one in comparison:
const balance = "1000000000000000000000";  // 1000 ETH
const requested = "1000000000000000001000";  // 1000.000000000000001 ETH (over by 1000 wei)
console.log(Number(requested) > Number(balance));  // false ⚠️ — passes the check
```

## Impact

- **F-16.1 — Overdraw / theft**: an attacker with balance `B` can request `B + ε` where `ε` is below the precision floor. The `amountBaseNum > totalAvailable` check returns `false`, the withdrawal proceeds, and the on-chain transfer for the requested amount executes. The DB then deducts `Number(B + ε) = B`, leaving the row at zero — but the on-chain transfer moved more than the user owned. Net result depends on what the contract enforces, but at minimum the DB and chain are out of sync.
- **F-16.2 — Failed legitimate withdrawals**: the inverse. A user with balance `B` requests `B`. After conversion, `Number(B)` rounds up; the `>` check fires, withdrawal blocked. UX bug becomes a security issue if it causes funds to be stuck.
- **F-16.3 — Stuck `Math.min` arithmetic**: `nonCollateralDeduction = Math.min(amountBaseNum, nonCollateralAmount)` and `collateralDeduction = amountBaseNum - nonCollateralDeduction` together can produce negative debits or zero debits when the operands round to the same Number, leaving balances unchanged while a transfer happens.
- **F-16.4 — Health factor / order USD value drift**: in the order worker, `Number(amount) * assetPrice` produces lossy USD values, which propagate into health-factor checks and potentially allow under-collateralized borrows.
- **F-16.5 — `Number("5e30") === Infinity`**: passes the `<= 0` validator, then explodes in viem. Information disclosure (F-14) plus DoS.

## Recommended Solution

### 1. Use `BigInt` end-to-end for base-unit amounts

`src/withdraw/withdraw.service.ts`:

```typescript
async withdraw(dto: WithdrawRequestDto, walletAddress: string) {
    const { assetId, amount } = dto;

    // Domain validation BEFORE conversion
    if (!/^\d+(\.\d+)?$/.test(amount)) {
        throw new BadRequestException("Amount must be a non-negative decimal number");
    }
    // Add a sane upper bound so we never call humanToBaseUnits with a 1KB string
    if (amount.length > 30) {
        throw new BadRequestException("Amount exceeds maximum supported precision");
    }

    const account = await this.orderRepository.findAccountByWallet(walletAddress);
    if (!account) throw new NotFoundException("Account not found");

    const token = await this.tokensService.getTokenByAssetId(assetId);
    if (!token) throw new NotFoundException("Token not found");

    const decimals = token.decimals ?? 18;

    // ✅ All arithmetic in BigInt — no precision loss
    const amountBase = BigInt(humanToBaseUnits(amount, decimals));
    if (amountBase <= 0n) {
        throw new BadRequestException("Amount must be positive");
    }

    return await withTransaction(this.dataSource, async (manager) => {
        const portfolioRows = await manager
            .createQueryBuilder(Portfolio, "p")
            .setLock("pessimistic_write")
            .where("p.accountId = :accountId", { accountId: account.id })
            .andWhere("p.assetId = :assetId", { assetId })
            .getMany();

        if (!portfolioRows?.length) {
            throw new BadRequestException("No balance found for this asset");
        }

        const nonCollateralRow = portfolioRows.find((p) => !p.isCollateral);
        const collateralRow = portfolioRows.find((p) => p.isCollateral);

        const nonCollateral = BigInt(nonCollateralRow?.amount ?? "0");
        const collateral = BigInt(collateralRow?.amount ?? "0");
        const locked = BigInt(nonCollateralRow?.lockedAmount ?? "0");
        const totalAvailable = nonCollateral + collateral - locked;

        if (amountBase > totalAvailable) {
            throw new BadRequestException(
                `Insufficient balance. Available: ${totalAvailable}, Requested: ${amountBase}`
            );
        }

        const nonCollateralDeduction =
            amountBase < nonCollateral ? amountBase : nonCollateral;
        const collateralDeduction = amountBase - nonCollateralDeduction;
        // ... apply debits using `.toString()` when persisting
    });
}
```

Apply the same pattern to:
- `src/portfolio/repay.service.ts` (`Number(amount)` on line 127)
- Any `Number(...)` on a base-unit string elsewhere

### 2. Centralize a `BigIntAmount` value object

To prevent future regressions, introduce a small helper that owns conversion and arithmetic:

```typescript
// src/common/utils/big-amount.ts
export class BigAmount {
    private constructor(public readonly base: bigint, public readonly decimals: number) {}

    static fromHuman(human: string, decimals: number): BigAmount {
        return new BigAmount(BigInt(humanToBaseUnits(human, decimals)), decimals);
    }
    static fromBase(base: string | bigint, decimals: number): BigAmount {
        return new BigAmount(typeof base === "bigint" ? base : BigInt(base), decimals);
    }
    add(o: BigAmount): BigAmount { return new BigAmount(this.base + o.base, this.decimals); }
    sub(o: BigAmount): BigAmount { return new BigAmount(this.base - o.base, this.decimals); }
    gt(o: BigAmount): boolean { return this.base > o.base; }
    lte(o: BigAmount): boolean { return this.base <= o.base; }
    isPositive(): boolean { return this.base > 0n; }
    toString(): string { return this.base.toString(); }
}
```

Banning `Number(amount)` in money paths is much easier with a typed value object.

### 3. USD value computations in the order worker

`Number(amount) * assetPrice` is acceptable for *display* USD values, but not for collateralization decisions. For health factor, port the math to a fixed-point representation (e.g. multiply price by `10^8`, keep base units in BigInt, divide once at the end).

### 4. DTO upper bounds (defense in depth)

Add a custom decorator or an explicit `MaxLength`:

```typescript
// src/withdraw/dto/withdraw.dto.ts
import { IsNotEmpty, IsString, IsUUID, MaxLength } from "class-validator";
import { IsPositiveNumericString } from "../../common/validators/amount.validator";

export class WithdrawRequestDto {
    @IsUUID()
    assetId: string;

    @IsString()
    @IsNotEmpty()
    @MaxLength(30, { message: "Amount string too long" })
    @IsPositiveNumericString()
    amount: string;
}
```

Same for `RepayRequestDto`.

## Verification

```bash
# Withdraw with off-by-1-wei overshoot, expect 400 (not silent acceptance):
curl -X POST http://localhost:8080/withdraw \
  -H "Authorization: Bearer DEV_TOKEN_0x..." \
  -d '{"assetId":"<asset>","amount":"<balance + 0.000000000000000001>"}'
# Expected: 400 Insufficient balance

# Withdraw 1e30 token, expect 400 (not crash, not Infinity, not viem trace):
curl -X POST http://localhost:8080/withdraw \
  -H "Authorization: Bearer DEV_TOKEN_0x..." \
  -d '{"assetId":"<asset>","amount":"1000000000000000000000000000000"}'
# Expected: 400 with a generic validation message

# Unit test the BigAmount helper for: fromHuman, gt, lte, sub edge cases at 2^53.
```

## References

- [MDN: Number.MAX_SAFE_INTEGER](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/MAX_SAFE_INTEGER)
- [Ethereum: Avoid Number for token amounts](https://ethereum.stackexchange.com/questions/4938/why-not-just-use-javascript-numbers-for-ethereum-money-amounts)
- [CWE-681](https://cwe.mitre.org/data/definitions/681.html), [CWE-682](https://cwe.mitre.org/data/definitions/682.html)
