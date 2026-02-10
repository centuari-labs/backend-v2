/**
 * Convert a decimal value (e.g. 0.75) to a percentage (e.g. 75).
 * Null or undefined values are treated as 0.
 */
export function toPercentage(value: number | null | undefined): number {
    if (value == null) {
        return 0;
    }

    return Number.parseFloat(value.toString()) / 100;
}

