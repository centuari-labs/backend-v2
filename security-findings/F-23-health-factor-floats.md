# F-23: Health-factor logic computed entirely in JS `Number` (floats)

**Severity**: 🔴 Critical (financial)
**OWASP**: A04 Insecure Design
**CWE**: CWE-682 (Incorrect Calculation), CWE-681 (Incorrect Conversion between Numeric Types)

## Summary

`computeHealthFactor` and `buildHealthFactorInputs` perform every step of the collateralization calculation — base-unit → human conversion, USD multiplication, weighted-LTV accumulation, and final division — in JavaScript `Number`. For 18-decimal tokens, the inputs already exceed `Number.MAX_SAFE_INTEGER` after a few thousand units, and the resulting HF can drift across the `1.0` liquidation/borrow threshold.

The same function is the gate that decides whether a borrow is allowed, whether collateral can be unset, and whether an order update would render the account unsafe. Any drift here is monetizable.

## Evidence

`src/portfolio/helpers/health-factor.helpers.ts:62-117`:

```typescript
export function computeHealthFactor(
    collateralPositions: CollateralPositionInput[],
    debtPositions: DebtPositionInput[],
    additionalDebtPositions?: DebtPositionInput[],
    additionalDebtUsd?: number,
): HealthFactorResult {
    let collateralUsd = 0;
    let weightedLtvSum = 0;

    for (const pos of collateralPositions) {
        const decimals = decimalsSafe(pos.decimals);
        const amountHuman = Number.parseFloat(             // ⚠️ float
            baseUnitsToHuman(pos.amountBaseUnits ?? "0", decimals),
        );
        const valueUsd =
            amountHuman * (Number.isFinite(pos.priceUsd) ? pos.priceUsd : 0);  // ⚠️ float
        const ltvDecimal = (pos.ltvBps ?? 0) / 10_000;     // ⚠️ float
        collateralUsd += valueUsd;                          // ⚠️ accumulating float
        weightedLtvSum += valueUsd * ltvDecimal;
    }

    let existingDebtUsd = 0;
    for (const pos of debtPositions) {
        const amountHuman = Number.parseFloat(
            baseUnitsToHuman(pos.amountBaseUnits ?? "0", decimalsSafe(pos.decimals)),
        );
        existingDebtUsd +=
            amountHuman * (Number.isFinite(pos.priceUsd) ? pos.priceUsd : 0);
    }

    const totalDebtUsd = existingDebtUsd + additionalDebtUsdSum;
    const weightedLtvDecimal =
        collateralUsd > 0 ? weightedLtvSum / collateralUsd : 0;

    let healthFactor: number;
    if (totalDebtUsd <= 0) {
        healthFactor = HEALTH_FACTOR_NO_DEBT;               // Number.POSITIVE_INFINITY
    } else {
        const numerator = (collateralUsd - existingDebtUsd) * weightedLtvDecimal;
        healthFactor = numerator / totalDebtUsd;            // ⚠️ final float division
        if (!Number.isFinite(healthFactor)) {
            healthFactor = 0;
        }
    }

    return { collateralUsd, debtUsd: totalDebtUsd, weightedLtvDecimal, healthFactor };
}
```

Callers that gate state on this output:

- `src/orders/orders.service.ts:280` — borrow create/update rejects `< MIN_HEALTH_FACTOR` (1.0).
- `src/portfolio/portfolio.service.ts:793` — `setAssetAsCollateral(false)` rejects `< MIN_HEALTH_FACTOR`.
- `src/portfolio/portfolio.service.ts:419` — `getMyHealthFactor` returns the value to the user.

`Number.parseFloat` of a base-unit string for an 18-decimal token loses precision past `~9.007 × 10¹⁵` base units (`~0.009 ETH`). Anything above that is rounded to the nearest representable double:

```javascript
Number.parseFloat("100500000000000000000")     // 1.005e20 — fine in magnitude
Number.parseFloat("100500000000000000000") === Number.parseFloat("100500000000000000001")
// true — 1 wei dropped
Number.parseFloat("999999999999999999999999")  // 1e24 — also fine, but loses last 9 digits
```

Multiplying that by `priceUsd` and accumulating compounds the error.

## Impact

- **F-23.1 — Borrow more than allowed**: an attacker constructs a collateral / debt mix that lands HF just above `1.0` in true math but, due to float drift, the computed HF reports `≥ 1.0` so the borrow is accepted. The actual position is undercollateralized.
- **F-23.2 — Reverse, in collusion with timing**: HF reports just below `1.0` for a position that's actually safe → user can't update / unset collateral / repay-with-rebalance because every operation that touches HF refuses. UX bug becomes a soft-lock that can be turned into a liquidation if a third party (or the operator) liquidates while the user is locked out.
- **F-23.3 — `Number.parseFloat("Infinity")` propagates**: if any single position has a degenerate `amountBaseUnits` (e.g. `"1e400"` from a forged NATS event per F-18), `amountHuman = Infinity`, and the entire `collateralUsd` becomes `Infinity`. `Number.isFinite(healthFactor)` fallback flips it to `0`, blocking everything.
- **F-23.4 — Combined with F-16**: withdraw and HF both lossy. Two layered drifts are easier to land on the boundary than one.
- **F-23.5 — `HEALTH_FACTOR_NO_DEBT` (Infinity) when `totalDebtUsd <= 0`**: see F-24 — a stale/missing price for a debt token can make `totalDebtUsd = 0` even when actual debt exists, returning Infinity HF and unblocking withdrawal.

## Reproduction

```bash
# Set up: account A has X ETH collateral and Y USDC debt where the boundary is
# HF = 0.9999... in BigInt but rounds to 1.00005 in Number after weighted-LTV mixing.
# Concrete numbers depend on chain / asset pair, but the unit test below
# demonstrates the principle without needing on-chain state:

# In a unit test environment:
import { computeHealthFactor } from "src/portfolio/helpers/health-factor.helpers";

const collateral = [{
    assetId: "WETH",
    amountBaseUnits: "10000000000000000000000",  // 10000 ETH at 18 decimals
    decimals: 18,
    priceUsd: 3000.123456789,                    // 14 sig figs
    ltvBps: 7500,
}];
const debt = [{
    assetId: "USDC",
    amountBaseUnits: "22500925000000",          // 22.500925 M USDC at 6 decimals
    decimals: 6,
    priceUsd: 1.0,
}];

// True (BigInt-fixed-point) HF and float HF will diverge; assert one
// of them lands above 1.0 while the other lands below.
console.log(computeHealthFactor(collateral, debt));
```

The exact boundary depends on chosen prices/amounts, but float math has a non-zero probability of crossing 1.0 in the wrong direction at the edge. Industry consensus is to never let that probability be non-zero on a money function.

## Recommended Solution

### 1. Use a fixed-point (scaled BigInt) representation end-to-end

Define a scale factor for prices (`PRICE_SCALE = 10n ** 8n`), scale prices once at ingestion, then do all arithmetic in `BigInt`:

```typescript
// src/portfolio/helpers/health-factor.helpers.ts
const PRICE_SCALE = 10n ** 8n;        // 1 USD = 1e8 in scaled space
const LTV_SCALE = 10_000n;            // bps
const HF_SCALE = 10_000n;             // 4-decimal HF

function scalePrice(priceUsd: number): bigint {
    if (!Number.isFinite(priceUsd) || priceUsd <= 0) return 0n;
    return BigInt(Math.round(priceUsd * Number(PRICE_SCALE)));
}

interface ScaledCollateral {
    amountBase: bigint;
    decimals: bigint;
    priceScaled: bigint;
    ltvBps: bigint;
}

interface ScaledDebt {
    amountBase: bigint;
    decimals: bigint;
    priceScaled: bigint;
}

export function computeHealthFactorScaled(
    collateral: ScaledCollateral[],
    debt: ScaledDebt[],
    additionalDebt: ScaledDebt[] = [],
): { collateralScaled: bigint; debtScaled: bigint; ltvScaledBps: bigint; hfScaled: bigint } {
    let collateralScaled = 0n;
    let weightedLtvScaled = 0n;

    for (const pos of collateral) {
        // valueScaled = amountBase * priceScaled / 10^decimals
        const valueScaled = (pos.amountBase * pos.priceScaled) / (10n ** pos.decimals);
        collateralScaled += valueScaled;
        weightedLtvScaled += valueScaled * pos.ltvBps;
    }

    let debtScaled = 0n;
    for (const pos of [...debt, ...additionalDebt]) {
        debtScaled += (pos.amountBase * pos.priceScaled) / (10n ** pos.decimals);
    }

    const ltvScaledBps = collateralScaled > 0n
        ? weightedLtvScaled / collateralScaled   // result in bps
        : 0n;

    if (debtScaled <= 0n) {
        return {
            collateralScaled, debtScaled, ltvScaledBps,
            hfScaled: -1n, // sentinel: NO_DEBT
        };
    }

    const existingDebtScaled = debtScaled;  // simplified; track separately if needed
    // HF = (C - D_existing) * LTV / D_total, scaled to HF_SCALE
    const numerator = (collateralScaled - existingDebtScaled) * ltvScaledBps;
    const hfScaled = (numerator * HF_SCALE) / (debtScaled * LTV_SCALE);

    return { collateralScaled, debtScaled, ltvScaledBps, hfScaled };
}
```

Comparisons:

```typescript
// Old: result.healthFactor < MIN_HEALTH_FACTOR  (float)
// New:
const MIN_HEALTH_FACTOR_SCALED = 1n * HF_SCALE;  // 10000
if (hfScaled !== -1n && hfScaled < MIN_HEALTH_FACTOR_SCALED) {
    throw new BadRequestException("Update would reduce health factor below 1");
}
```

API formatting (only place `Number` enters):

```typescript
export function formatHealthFactorResponse({ hfScaled, debtScaled, collateralScaled, ltvScaledBps }) {
    return {
        healthFactor: hfScaled === -1n
            ? Number.POSITIVE_INFINITY
            : Number(hfScaled) / Number(HF_SCALE),  // ⚠️ Number ONLY for display
        debtUsd: Number(debtScaled) / Number(PRICE_SCALE),
        collateralUsd: Number(collateralScaled) / Number(PRICE_SCALE),
        weightedLtv: Number(ltvScaledBps) / 10_000,
    };
}
```

### 2. Reject borrows / withdrawals when any required price is missing

Don't silently substitute `0` for missing prices (see F-24):

```typescript
function scalePriceStrict(priceUsd: number | undefined, assetId: string): bigint {
    if (priceUsd === undefined || !Number.isFinite(priceUsd) || priceUsd <= 0) {
        throw new BadRequestException(
            `Price unavailable for asset ${assetId}; please retry`,
        );
    }
    return BigInt(Math.round(priceUsd * Number(PRICE_SCALE)));
}
```

This forces all HF inputs to be present before the calculation runs — no more "value of position = $0" silent default.

### 3. Property-based tests

Add a `fast-check` property test that compares the new BigInt HF against a high-precision rational implementation (e.g. `decimal.js`) over random inputs:

```typescript
import fc from "fast-check";
import { computeHealthFactorScaled } from "...";
import Decimal from "decimal.js";

test("HF matches arbitrary-precision reference", () => {
    fc.assert(fc.property(
        fc.array(fc.record({ amount: fc.bigInt(), price: fc.float({ min: 0.01, max: 1e9 }), ... }), { maxLength: 10 }),
        // same for debt
        (collateral, debt) => {
            const ours = computeHealthFactorScaled(...);
            const ref = referenceUsingDecimalJs(...);
            // assert |ours - ref| < epsilon
        }
    ));
});
```

### 4. Hard-cap aggregate magnitudes

Before passing values into HF math, sanity-check totals to reject obvious garbage:

```typescript
const MAX_REASONABLE_USD_SCALED = 10_000_000_000n * PRICE_SCALE;  // $10B
if (collateralScaled > MAX_REASONABLE_USD_SCALED || debtScaled > MAX_REASONABLE_USD_SCALED) {
    this.logger.error(`HF aggregates out of bounds: c=${collateralScaled} d=${debtScaled}`);
    throw new InternalServerErrorException("HF inputs out of bounds — investigate");
}
```

This catches forged events (F-18) and oracle blow-ups (F-24) before they cascade.

## Verification

```bash
# Property-based test must pass with epsilon = 0 against the reference
pnpm test src/portfolio/helpers/health-factor.helpers.spec.ts

# Targeted boundary test
node -e "
const { computeHealthFactorScaled, formatHealthFactorResponse } = require('./dist/portfolio/helpers/health-factor.helpers');
// Construct an input where Number-based HF differs from BigInt HF on the third decimal.
// Assert BigInt HF is the one used in gating.
"

# End-to-end:
# 1. Place borrow that lands HF at 1.0001 in BigInt math.
# 2. Update by 1 wei to push BigInt HF to 0.9999.
# 3. Update should be rejected. Today, with floats, it sometimes is and sometimes isn't.
```

## References

- [MakerDAO: Why Decimal Math Matters in DeFi](https://blog.makerdao.com/the-strangelove-tradeoff/)
- [Compound: Fixed-point arithmetic in `CToken`](https://github.com/compound-finance/compound-protocol/blob/master/contracts/Exponential.sol)
- [Aave: WadRayMath](https://github.com/aave/aave-v3-core/blob/master/contracts/protocol/libraries/math/WadRayMath.sol)
- [CWE-682: Incorrect Calculation](https://cwe.mitre.org/data/definitions/682.html)
