import * as fs from "node:fs";
import * as path from "node:path";
import {
    computeHealthFactor,
    type CollateralPositionInput,
    type DebtPositionInput,
} from "../../portfolio/helpers/health-factor.helpers";

/**
 * SC-9: cross-check the backend health-factor against the on-chain RiskModule
 * using a SHARED fixture. The Solidity side
 * (smart-contract-revamp/test/risk/RiskModuleHFCrossCheck.t.sol) asserts the same
 * vectors against `RiskModule._healthyAfter`, so the two HF implementations cannot
 * silently drift apart.
 *
 * Values are human-scale USD; HF is scale-invariant, so here we feed each value as
 * `amountBaseUnits` with `decimals: 0` and `priceUsd: 1`. healthy iff
 * HF >= 1 + bufferBps/10000 (mirrors OrdersService.validateHealthFactor).
 */
interface Vectors {
    name: string[];
    bufferBps: number[];
    coll0Value: number[];
    coll0Ltv: number[];
    coll1Value: number[];
    coll1Ltv: number[];
    debt0Value: number[];
    expectedHealthy: boolean[];
}

const FIXTURE_PATH = path.resolve(
    __dirname,
    "../../../../smart-contract-revamp/test/fixtures/hf-cross-check-vectors.json",
);

describe("SC-9 HF cross-check (shared on/off-chain vectors)", () => {
    const v: Vectors = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));

    it("backend computeHealthFactor verdicts match the shared fixture", () => {
        const n = v.bufferBps.length;
        expect(n).toBeGreaterThan(0);

        for (let i = 0; i < n; i++) {
            const collateral: CollateralPositionInput[] = [
                {
                    assetId: "c0",
                    amountBaseUnits: String(v.coll0Value[i]),
                    decimals: 0,
                    priceUsd: 1,
                    ltvBps: v.coll0Ltv[i],
                },
            ];
            if (v.coll1Value[i] > 0) {
                collateral.push({
                    assetId: "c1",
                    amountBaseUnits: String(v.coll1Value[i]),
                    decimals: 0,
                    priceUsd: 1,
                    ltvBps: v.coll1Ltv[i],
                });
            }
            const debt: DebtPositionInput[] =
                v.debt0Value[i] > 0
                    ? [
                          {
                              assetId: "d0",
                              amountBaseUnits: String(v.debt0Value[i]),
                              decimals: 0,
                              priceUsd: 1,
                          },
                      ]
                    : [];

            const result = computeHealthFactor(collateral, debt);
            const threshold = 1 + v.bufferBps[i] / 10_000;
            const healthy = result.healthFactor >= threshold;

            expect({ name: v.name[i], healthy }).toEqual({
                name: v.name[i],
                healthy: v.expectedHealthy[i],
            });
        }
    });
});
