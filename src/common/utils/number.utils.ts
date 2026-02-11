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

