import {
    baseUnitsToHuman,
    calculateSettlementFee,
    humanToBaseUnits,
    toPercentage,
} from "../../../common/utils/number.utils";

describe("toPercentage", () => {
    it("should convert basis points to percentage", () => {
        expect(toPercentage(0)).toBe(0);
        expect(toPercentage(100)).toBe(1);
        expect(toPercentage(7500)).toBe(75);
        expect(toPercentage(12345)).toBe(123.45);
    });

    it("should handle null and undefined as 0", () => {
        expect(toPercentage(null as any)).toBe(0);
        expect(toPercentage(undefined as any)).toBe(0);
    });

    it("should handle numeric strings", () => {
        expect(toPercentage("7500" as any)).toBe(75);
        expect(toPercentage("0" as any)).toBe(0);
    });

    it("should return 0 for NaN input", () => {
        expect(toPercentage("not-a-number" as any)).toBe(0);
    });
});

describe("humanToBaseUnits", () => {
    it("converts whole numbers correctly", () => {
        expect(humanToBaseUnits("1", 6)).toBe("1000000");
        expect(humanToBaseUnits("0", 6)).toBe("0");
        expect(humanToBaseUnits("10", 6)).toBe("10000000");
    });

    it("converts decimal numbers correctly", () => {
        expect(humanToBaseUnits("1.23", 6)).toBe("1230000");
        expect(humanToBaseUnits("0.000001", 6)).toBe("1");
        expect(humanToBaseUnits("0.0001", 6)).toBe("100");
    });

    it("pads fractional part when shorter than decimals", () => {
        expect(humanToBaseUnits("1.2", 6)).toBe("1200000");
        expect(humanToBaseUnits("1.2", 2)).toBe("120");
    });

    it("throws on too many decimal places", () => {
        expect(() => humanToBaseUnits("1.234", 2)).toThrow(
            "Too many decimal places for token",
        );
    });

    it("throws on negative values", () => {
        expect(() => humanToBaseUnits("-1", 6)).toThrow(
            "Amount must be non-negative",
        );
    });

    it("throws on invalid format", () => {
        expect(() => humanToBaseUnits("abc", 6)).toThrow(
            "Amount must be a valid positive number",
        );
    });
});

describe("baseUnitsToHuman", () => {
    it("converts base units to whole numbers correctly", () => {
        expect(baseUnitsToHuman("1000000", 6)).toBe("1");
        expect(baseUnitsToHuman("0", 6)).toBe("0");
    });

    it("converts base units to decimals correctly", () => {
        expect(baseUnitsToHuman("1230000", 6)).toBe("1.23");
        expect(baseUnitsToHuman("100", 6)).toBe("0.0001");
    });

    it("handles decimals = 0", () => {
        expect(baseUnitsToHuman("123", 0)).toBe("123");
    });

    it("handles PostgreSQL NUMERIC trailing zeros", () => {
        expect(baseUnitsToHuman("1230000.00", 6)).toBe("1.23");
        expect(baseUnitsToHuman("1000000.0", 6)).toBe("1");
        expect(baseUnitsToHuman("0.00", 6)).toBe("0");
        expect(baseUnitsToHuman("100.000", 6)).toBe("0.0001");
    });

    it("handles PostgreSQL NUMERIC non-zero fractional parts", () => {
        // "9999999.91" with 8 decimals → absorb ".91" → "999999991" with 10 effective decimals
        expect(baseUnitsToHuman("9999999.91", 8)).toBe("0.0999999991");
        // "1000000.50" with 6 decimals → absorb ".5" → "10000005" with 7 effective decimals
        expect(baseUnitsToHuman("1000000.50", 6)).toBe("1.0000005");
        // "1.23" with 6 decimals → absorb ".23" → "123" with 8 effective decimals
        expect(baseUnitsToHuman("1.23", 6)).toBe("0.00000123");
    });

    it("clamps negative values to zero", () => {
        expect(baseUnitsToHuman("-100", 6)).toBe("0");
        expect(baseUnitsToHuman("-0", 6)).toBe("0");
    });

    it("throws on truly invalid base units format", () => {
        expect(() => baseUnitsToHuman("abc", 6)).toThrow(
            "Base units amount must be a non-negative integer",
        );
    });
});

describe("calculateSettlementFee", () => {
    it("applies USD cap when raw fee exceeds max", () => {
        // 1000 * 0.01% = 0.1 token, price = 1 → capped to 0.05
        const fee = calculateSettlementFee(1000, 1);
        expect(fee).toBe(0.05);
    });

    it("uses raw fee when under cap", () => {
        // 100 * 0.01% = 0.01 token, price = 1 → below 0.05 cap
        const fee = calculateSettlementFee(100, 1);
        expect(fee).toBe(0.01);
    });

    it("returns 0 for non-positive amount", () => {
        expect(calculateSettlementFee(0, 1)).toBe(0);
        expect(calculateSettlementFee(-10, 1)).toBe(0);
    });

    it("returns 0 for non-positive price", () => {
        expect(calculateSettlementFee(1000, 0)).toBe(0);
        expect(calculateSettlementFee(1000, -1)).toBe(0);
    });

    it("respects custom fee rate and max cap", () => {
        // 1000 * 1% (100 bps) = 10, cap 0.05 → capped
        expect(calculateSettlementFee(1000, 1, 100, 0.05)).toBe(0.05);
        // 100 * 1% = 1, cap 5 → not capped
        expect(calculateSettlementFee(100, 1, 100, 5)).toBe(1);
    });
});
