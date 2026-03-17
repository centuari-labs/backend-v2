import {
    computeHealthFactor,
    formatHealthFactorResponse,
    HEALTH_FACTOR_NO_DEBT,
    type CollateralPositionInput,
    type DebtPositionInput,
} from "../../portfolio/helpers/health-factor.helpers";

describe("health-factor.helpers", () => {
    describe("computeHealthFactor", () => {
        it("single-asset collateral and debt: correct USD and HF", () => {
            // 1 ETH (18 decimals) @ 3000 USD, LTV 75% (7500 bps); 500 USDC (6 decimals) @ 1 USD debt
            const collateral: CollateralPositionInput[] = [
                {
                    assetId: "eth-uuid",
                    amountBaseUnits: "1000000000000000000",
                    decimals: 18,
                    priceUsd: 3000,
                    ltvBps: 7500,
                },
            ];
            const debt: DebtPositionInput[] = [
                {
                    assetId: "usdc-uuid",
                    amountBaseUnits: "500000000",
                    decimals: 6,
                    priceUsd: 1,
                },
            ];
            const result = computeHealthFactor(collateral, debt);
            expect(result.collateralUsd).toBe(3000);
            expect(result.debtUsd).toBe(500);
            // HF = ((3000 - 500) * 0.75) / 500 = 2500 * 0.75 / 500 = 3.75
            expect(result.weightedLtvDecimal).toBe(0.75);
            expect(result.healthFactor).toBe(3.75);
        });

        it("multi-asset collateral: weighted LTV", () => {
            // 1000 USD @ 80% LTV + 2000 USD @ 50% LTV => weighted = (1000*0.8 + 2000*0.5)/3000 = 0.6
            const collateral: CollateralPositionInput[] = [
                {
                    assetId: "a",
                    amountBaseUnits: "1000000000",
                    decimals: 6,
                    priceUsd: 1,
                    ltvBps: 8000,
                },
                {
                    assetId: "b",
                    amountBaseUnits: "2000000000",
                    decimals: 6,
                    priceUsd: 1,
                    ltvBps: 5000,
                },
            ];
            const debt: DebtPositionInput[] = [
                {
                    assetId: "c",
                    amountBaseUnits: "500000000",
                    decimals: 6,
                    priceUsd: 1,
                },
            ];
            const result = computeHealthFactor(collateral, debt);
            expect(result.collateralUsd).toBe(3000);
            expect(result.debtUsd).toBe(500);
            expect(result.weightedLtvDecimal).toBeCloseTo(0.6, 10);
            // HF = ((3000 - 500) * 0.6) / 500 = 3
            expect(result.healthFactor).toBe(3);
        });

        it("zero debt: returns HEALTH_FACTOR_NO_DEBT", () => {
            const collateral: CollateralPositionInput[] = [
                {
                    assetId: "a",
                    amountBaseUnits: "1000000",
                    decimals: 6,
                    priceUsd: 1,
                    ltvBps: 7500,
                },
            ];
            const result = computeHealthFactor(collateral, []);
            expect(result.debtUsd).toBe(0);
            expect(result.healthFactor).toBe(HEALTH_FACTOR_NO_DEBT);
        });

        it("zero collateral and positive debt: HF below 1", () => {
            const debt: DebtPositionInput[] = [
                {
                    assetId: "a",
                    amountBaseUnits: "1000000",
                    decimals: 6,
                    priceUsd: 1,
                },
            ];
            const result = computeHealthFactor([], debt);
            expect(result.collateralUsd).toBe(0);
            expect(result.debtUsd).toBe(1);
            expect(result.weightedLtvDecimal).toBe(0);
            // ((0 - 1) * 0) / 1 = 0 (may be -0 in JS)
            expect(result.healthFactor).toBeCloseTo(0, 10);
        });

        it("tiny amounts with 6 and 18 decimals", () => {
            const collateral: CollateralPositionInput[] = [
                {
                    assetId: "a",
                    amountBaseUnits: "1",
                    decimals: 18,
                    priceUsd: 3000,
                    ltvBps: 7500,
                },
            ];
            const debt: DebtPositionInput[] = [
                {
                    assetId: "b",
                    amountBaseUnits: "1",
                    decimals: 6,
                    priceUsd: 1,
                },
            ];
            const result = computeHealthFactor(collateral, debt);
            // 1e-18 * 3000 = 3e-15; 1e-6 * 1 = 1e-6
            expect(result.collateralUsd).toBeCloseTo(3e-15, 20);
            expect(result.debtUsd).toBeCloseTo(1e-6, 10);
        });

        it("HF exactly 1 when (C - D) * LTV = D", () => {
            // C = 2000, D = 1000, LTV = 0.5 => (2000-1000)*0.5/1000 = 0.5 -> not 1
            // (C - D) * LTV = D  =>  (C - D) * LTV / D = 1  =>  e.g. C=2000, D=1000, LTV=1 => (1000*1)/1000 = 1
            const collateral: CollateralPositionInput[] = [
                {
                    assetId: "a",
                    amountBaseUnits: "2000000000",
                    decimals: 6,
                    priceUsd: 1,
                    ltvBps: 10000,
                },
            ];
            const debt: DebtPositionInput[] = [
                {
                    assetId: "b",
                    amountBaseUnits: "1000000000",
                    decimals: 6,
                    priceUsd: 1,
                },
            ];
            const result = computeHealthFactor(collateral, debt);
            expect(result.healthFactor).toBe(1);
        });

        it("HF < 1 when borrow would be unsafe", () => {
            const collateral: CollateralPositionInput[] = [
                {
                    assetId: "a",
                    amountBaseUnits: "1000000000",
                    decimals: 6,
                    priceUsd: 1,
                    ltvBps: 8000,
                },
            ];
            const debt: DebtPositionInput[] = [
                {
                    assetId: "b",
                    amountBaseUnits: "900000000",
                    decimals: 6,
                    priceUsd: 1,
                },
            ];
            const result = computeHealthFactor(collateral, debt);
            // (1000 - 900) * 0.8 / 900 = 80/900 < 1
            expect(result.healthFactor).toBeLessThan(1);
        });

        it("with additional debt: HF = (collateral - existingDebt) * LTV / (existingDebt + additionalDebt)", () => {
            // Collateral 3000, existing debt 500, additional debt 100, LTV 0.75
            const collateral: CollateralPositionInput[] = [
                {
                    assetId: "eth-uuid",
                    amountBaseUnits: "1000000000000000000",
                    decimals: 18,
                    priceUsd: 3000,
                    ltvBps: 7500,
                },
            ];
            const existingDebt: DebtPositionInput[] = [
                {
                    assetId: "usdc-uuid",
                    amountBaseUnits: "500000000",
                    decimals: 6,
                    priceUsd: 1,
                },
            ];
            const additionalDebt: DebtPositionInput[] = [
                {
                    assetId: "usdc-uuid",
                    amountBaseUnits: "100000000",
                    decimals: 6,
                    priceUsd: 1,
                },
            ];
            const result = computeHealthFactor(
                collateral,
                existingDebt,
                additionalDebt,
            );
            expect(result.collateralUsd).toBe(3000);
            expect(result.debtUsd).toBe(600); // 500 + 100 total
            expect(result.weightedLtvDecimal).toBe(0.75);
            // (3000 - 500) * 0.75 / (500 + 100) = 1875 / 600 = 3.125
            expect(result.healthFactor).toBe(3.125);
        });
    });

    describe("formatHealthFactorResponse", () => {
        it("formats with fixed precision", () => {
            const raw = {
                collateralUsd: 1234.5678,
                debtUsd: 100.111,
                weightedLtvDecimal: 0.7523,
                healthFactor: 2.34567,
            };
            const out = formatHealthFactorResponse(raw as any);
            expect(out.collateralUsd).toBe(1234.57);
            expect(out.debtUsd).toBe(100.11);
            expect(out.weightedLtv).toBe(0.7523);
            expect(out.healthFactor).toBe(2.3457);
        });

        it("preserves Infinity for no-debt HF", () => {
            const raw = {
                collateralUsd: 1000,
                debtUsd: 0,
                weightedLtvDecimal: 0.75,
                healthFactor: HEALTH_FACTOR_NO_DEBT,
            };
            const out = formatHealthFactorResponse(raw as any);
            expect(out.healthFactor).toBe(Number.POSITIVE_INFINITY);
        });
    });
});
