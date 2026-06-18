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

const FIXTURE_REL_PATH =
    "smart-contract-revamp/test/fixtures/hf-cross-check-vectors.json";

/**
 * Resolve the shared HF cross-check fixture robustly, regardless of how deeply
 * the backend-v2 checkout is nested. The previous hard-coded
 * `../../../../smart-contract-revamp/...` path assumed backend-v2 was a direct
 * sibling of smart-contract-revamp under the polyrepo root, which breaks when
 * the suite runs inside a per-session git worktree
 * (`backend-v2/.claude/worktrees/<id>/`, 3 levels deeper).
 *
 * Resolution order:
 *   1. `HF_FIXTURE_PATH` env override (explicit escape hatch for CI/containers).
 *   2. Walk up from this file until a directory contains the fixture at
 *      `<dir>/smart-contract-revamp/test/fixtures/...` — finds the polyrepo
 *      root from both the main checkout and any worktree depth.
 */
function resolveFixturePath(): string {
    const override = process.env.HF_FIXTURE_PATH;
    if (override) {
        return path.resolve(override);
    }

    let dir = __dirname;
    while (true) {
        const candidate = path.join(dir, FIXTURE_REL_PATH);
        if (fs.existsSync(candidate)) {
            return candidate;
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            throw new Error(
                `Could not locate ${FIXTURE_REL_PATH} by walking up from ` +
                    `${__dirname}. Set HF_FIXTURE_PATH to point at the shared fixture.`,
            );
        }
        dir = parent;
    }
}

const FIXTURE_PATH = resolveFixturePath();

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
