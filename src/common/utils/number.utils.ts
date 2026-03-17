/**
 * Convert a basis-points value (e.g. 7500) to a percentage (e.g. 75).
 *
 * This function is intended for formatting values for API responses and UI:
 * - Input is always in basis points (bp), where 100 bp = 1%.
 * - Output is the human-readable percentage value in the 0–100 range.
 * - Null or undefined values are treated as 0.
 */
export function toPercentage(value: number | null | undefined): number {
    if (value == null) {
        return 0;
    }

    const numericValue = Number.parseFloat(value.toString());
    if (Number.isNaN(numericValue)) {
        return 0;
    }

    return numericValue / 100;
}

/**
 * Convert a human-readable token amount into base units using the token decimals.
 *
 * Examples (decimals = 6):
 * - "1"     -> "1000000"
 * - "1.23"  -> "1230000"
 * - "0.0001" (decimals = 6) -> "100"
 *
 * This function uses string-based arithmetic to avoid precision issues and
 * should be used for all conversions that will be persisted or sent on-chain.
 *
 * @throws Error if the amount format is invalid or has too many decimal places.
 */
export function humanToBaseUnits(
    amount: string | number,
    decimals: number,
): string {
    if (!Number.isInteger(decimals) || decimals < 0) {
        throw new Error("Invalid decimals value");
    }

    const raw = amount.toString().trim();
    if (raw.length === 0) {
        throw new Error("Amount is required");
    }

    if (raw.startsWith("-")) {
        throw new Error("Amount must be non-negative");
    }

    const numericRegex = /^\+?\d+(\.\d+)?$/;
    if (!numericRegex.test(raw)) {
        throw new Error("Amount must be a valid positive number");
    }

    const normalized = raw.startsWith("+") ? raw.slice(1) : raw;
    const [integerPartRaw, fractionalPartRaw = ""] = normalized.split(".");

    const integerPart = integerPartRaw.replace(/^0+(?=\d)/, "") || "0";

    if (decimals === 0) {
        // If decimals is 0, we must not have any non-zero fractional part
        if (fractionalPartRaw && /[1-9]/.test(fractionalPartRaw)) {
            throw new Error("Too many decimal places for token");
        }
        return integerPart;
    }

    if (fractionalPartRaw.length > decimals) {
        throw new Error("Too many decimal places for token");
    }

    const fractionalPartPadded = fractionalPartRaw.padEnd(decimals, "0");

    const combined = `${integerPart}${fractionalPartPadded}`;
    // Normalize leading zeros, but keep at least a single "0"
    const normalizedCombined = combined.replace(/^0+(?=\d)/, "") || "0";

    return normalizedCombined;
}

/**
 * Convert a base-unit token amount into a human-readable string using decimals.
 *
 * Examples (decimals = 6):
 * - "1000000"   -> "1"
 * - "1230000"   -> "1.23"
 * - "100"       -> "0.0001"
 */
export function baseUnitsToHuman(
    amount: string | number,
    decimals: number,
): string {
    if (!Number.isInteger(decimals) || decimals < 0) {
        throw new Error("Invalid decimals value");
    }

    let raw = amount.toString().trim();

    // Strip trailing decimal zeros from PostgreSQL NUMERIC columns (e.g. "1230000.00" → "1230000")
    const dotIndex = raw.indexOf(".");
    if (dotIndex !== -1) {
        const fractional = raw.slice(dotIndex + 1);
        if (/^0*$/.test(fractional)) {
            raw = raw.slice(0, dotIndex);
        }
    }

    if (!/^\d+$/.test(raw)) {
        throw new Error("Base units amount must be a non-negative integer");
    }

    if (decimals === 0) {
        return raw.replace(/^0+(?=\d)/, "") || "0";
    }

    if (raw === "0") {
        return "0";
    }

    const padded = raw.padStart(decimals + 1, "0");
    const integerPartRaw = padded.slice(0, padded.length - decimals);
    const fractionalPartRaw = padded.slice(-decimals);

    const integerPart = integerPartRaw.replace(/^0+(?=\d)/, "") || "0";
    const fractionalPartTrimmed = fractionalPartRaw.replace(/0+$/, "");

    if (fractionalPartTrimmed.length === 0) {
        return integerPart;
    }

    return `${integerPart}.${fractionalPartTrimmed}`;
}

/**
 * Calculate the settlement fee for an order in human-readable token units.
 *
 * The fee is computed as:
 * 1. rawFeeInToken = amountHuman * (feeRateBps / 10000)
 * 2. feeInUsd = rawFeeInToken * priceUsd
 * 3. If feeInUsd > maxCapUsd:
 *      feeInToken = maxCapUsd / priceUsd
 *    else:
 *      feeInToken = rawFeeInToken
 *
 * @param amountHuman - Order amount in human-readable token units (e.g. 1000 USDC)
 * @param priceUsd - Token price in USD
 * @param feeRateBps - Fee rate in basis points (default 1 = 0.01%)
 * @param maxCapUsd - Maximum fee in USD (default 0.05)
 */
export function calculateSettlementFee(
    amountHuman: number,
    priceUsd: number,
    feeRateBps = 1,
    maxCapUsd = 0.05,
): number {
    if (
        !Number.isFinite(amountHuman) ||
        !Number.isFinite(priceUsd) ||
        amountHuman <= 0 ||
        priceUsd <= 0 ||
        feeRateBps <= 0 ||
        maxCapUsd <= 0
    ) {
        return 0;
    }

    const feeRate = feeRateBps / 10000;
    const rawFeeInToken = amountHuman * feeRate;
    const feeInUsd = rawFeeInToken * priceUsd;

    const feeInToken =
        feeInUsd > maxCapUsd ? maxCapUsd / priceUsd : rawFeeInToken;

    // Limit to a sensible precision to avoid floating point noise
    return Number(feeInToken.toFixed(8));
}
