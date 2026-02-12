import {
    baseUnitsToHuman,
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

    it("throws on invalid base units format", () => {
        expect(() => baseUnitsToHuman("1.23", 6)).toThrow(
            "Base units amount must be a non-negative integer",
        );
    });
});


