export interface MaturityValidationResult {
    isValid: boolean;
    allowedMaturities: number[];
}

/**
 * Compute the three allowed maturity timestamps (Unix seconds, UTC) for the
 * first day of the next three calendar months relative to the provided `now`.
 */
export function getAllowedMaturitiesUtcSeconds(now: Date = new Date()): number[] {
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth(); // 0-based

    const allowedDates: number[] = [];

    for (let offset = 1; offset <= 3; offset++) {
        const targetMonthIndex = month + offset;
        const targetYear = year + Math.floor(targetMonthIndex / 12);
        const normalizedMonth = targetMonthIndex % 12;

        const utcMs = Date.UTC(targetYear, normalizedMonth, 1, 0, 0, 0, 0);
        allowedDates.push(Math.floor(utcMs / 1000));
    }

    return allowedDates;
}

/**
 * Validate that all provided maturities:
 * - Are Unix timestamps in seconds.
 * - Correspond to the 1st day of some month in UTC.
 * - Are within the first day of the next three calendar months (UTC) relative to `now`.
 */
export function validateMaturitiesUtcSeconds(
    maturities: number[],
    now: Date = new Date(),
): MaturityValidationResult {
    if (!Array.isArray(maturities) || maturities.length === 0) {
        return { isValid: false, allowedMaturities: [] };
    }

    const allowed = getAllowedMaturitiesUtcSeconds(now);
    const allowedSet = new Set(allowed);

    for (const ts of maturities) {
        if (typeof ts !== "number" || !Number.isFinite(ts)) {
            return { isValid: false, allowedMaturities: allowed };
        }

        const date = new Date(ts * 1000);
        if (Number.isNaN(date.getTime())) {
            return { isValid: false, allowedMaturities: allowed };
        }

        // Ensure it's the 1st of the month in UTC
        if (date.getUTCDate() !== 1) {
            return { isValid: false, allowedMaturities: allowed };
        }

        // Ensure it matches one of the three allowed first-of-month dates
        if (!allowedSet.has(ts)) {
            return { isValid: false, allowedMaturities: allowed };
        }
    }

    return { isValid: true, allowedMaturities: allowed };
}

