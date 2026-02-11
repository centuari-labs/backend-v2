import { toPercentage } from "./number.utils";

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

