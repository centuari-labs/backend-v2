import { baseUnitsToHuman } from "../../common/utils/number.utils";

/** Collateral position: amount in base units, with decimals, price and LTV (basis points). */
export interface CollateralPositionInput {
    assetId: string;
    amountBaseUnits: string;
    decimals: number;
    priceUsd: number;
    /** LTV in basis points (e.g. 7500 = 75%). */
    ltvBps: number;
}

/** Debt position: amount in base units, with decimals and price. */
export interface DebtPositionInput {
    assetId: string;
    amountBaseUnits: string;
    decimals: number;
    priceUsd: number;
}

export interface HealthFactorResult {
    collateralUsd: number;
    debtUsd: number;
    weightedLtvDecimal: number;
    healthFactor: number;
}

export interface HealthFactorOptions {
    additionalDebt?: { assetId: string; amountBaseUnits: string };
    additionalBorrowUsd?: number;
    includeOpenOrders?: boolean;
}

/** When debt is zero, we return this sentinel so callers can format as needed. */
export const HEALTH_FACTOR_NO_DEBT = Number.POSITIVE_INFINITY;

/** Minimum health factor required to unset collateral. */
export const MIN_HEALTH_FACTOR = 1.0;

/**
 * Compute decimal-aware, weighted-LTV-based health factor.
 *
 * When additionalDebtPositions is omitted or empty:
 *   HF = ((C_usd - D_usd) * LTV_weighted) / D_usd
 *
 * When additionalDebtPositions is provided (e.g. prospective borrow):
 *   HF = ((C_usd - D_existing) * LTV_weighted) / D_total
 *   where D_total = D_existing + D_additional.
 *
 * LTV_weighted = sum(valueUsd_i * ltvDecimal_i) / sum(valueUsd_i) over collateral.
 *
 * - If D_total <= 0, returns HEALTH_FACTOR_NO_DEBT (Infinity).
 * - Zero collateral: weightedLtvDecimal = 0; HF can be negative or NaN, so we treat as 0 for safety.
 */
export function computeHealthFactor(
    collateralPositions: CollateralPositionInput[],
    debtPositions: DebtPositionInput[],
    additionalDebtPositions?: DebtPositionInput[],
    additionalDebtUsd?: number,
): HealthFactorResult {
    let collateralUsd = 0;
    let weightedLtvSum = 0;
    const decimalsSafe = (d: number) =>
        d != null && Number.isInteger(d) && d >= 0 ? d : 0;

    for (const pos of collateralPositions) {
        const decimals = decimalsSafe(pos.decimals);
        const amountHuman = Number.parseFloat(
            baseUnitsToHuman(pos.amountBaseUnits ?? "0", decimals),
        );
        const valueUsd =
            amountHuman * (Number.isFinite(pos.priceUsd) ? pos.priceUsd : 0);
        const ltvDecimal = (pos.ltvBps ?? 0) / 10_000;
        collateralUsd += valueUsd;
        weightedLtvSum += valueUsd * ltvDecimal;
    }

    let existingDebtUsd = 0;
    for (const pos of debtPositions) {
        const decimals = decimalsSafe(pos.decimals);
        const amountHuman = Number.parseFloat(
            baseUnitsToHuman(pos.amountBaseUnits ?? "0", decimals),
        );
        existingDebtUsd +=
            amountHuman * (Number.isFinite(pos.priceUsd) ? pos.priceUsd : 0);
    }

    const additional = additionalDebtPositions ?? [];
    let additionalDebtUsdSum = additionalDebtUsd ?? 0;
    for (const pos of additional) {
        const decimals = decimalsSafe(pos.decimals);
        const amountHuman = Number.parseFloat(
            baseUnitsToHuman(pos.amountBaseUnits ?? "0", decimals),
        );
        additionalDebtUsdSum +=
            amountHuman * (Number.isFinite(pos.priceUsd) ? pos.priceUsd : 0);
    }

    const totalDebtUsd = existingDebtUsd + additionalDebtUsdSum;
    const totalCollateralValue = collateralUsd;
    const weightedLtvDecimal =
        totalCollateralValue > 0 ? weightedLtvSum / totalCollateralValue : 0;

    let healthFactor: number;
    if (totalDebtUsd <= 0) {
        healthFactor = HEALTH_FACTOR_NO_DEBT;
    } else {
        const numerator =
            (collateralUsd - existingDebtUsd) * weightedLtvDecimal;
        healthFactor = numerator / totalDebtUsd;
        if (!Number.isFinite(healthFactor)) {
            healthFactor = 0;
        }
    }

    return {
        collateralUsd,
        debtUsd: totalDebtUsd,
        weightedLtvDecimal,
        healthFactor,
    };
}

/** Format HF and weighted LTV to fixed precision for API responses. */
const HF_PRECISION = 4;
const LTV_PRECISION = 4;

export function formatHealthFactorResponse(result: HealthFactorResult): {
    collateralUsd: number;
    debtUsd: number;
    weightedLtv: number;
    healthFactor: number;
} {
    const hf =
        result.healthFactor === HEALTH_FACTOR_NO_DEBT
            ? Number.POSITIVE_INFINITY
            : result.healthFactor;
    return {
        collateralUsd: Number(result.collateralUsd.toFixed(2)),
        debtUsd: Number(result.debtUsd.toFixed(2)),
        weightedLtv: Number(result.weightedLtvDecimal.toFixed(LTV_PRECISION)),
        healthFactor: Number.isFinite(hf)
            ? Number(hf.toFixed(HF_PRECISION))
            : hf,
    };
}
