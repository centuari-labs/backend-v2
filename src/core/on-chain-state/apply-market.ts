import {
    type MarketCreatedArgs,
    applyMarketCreatedMutation,
} from "@centuari-labs/on-chain-effects";
import type { Pool } from "pg";

/**
 * Eager-register markets on the shared `market` table BEFORE any on-chain
 * `Centuari.MarketCreated` event exists (the contract only emits that on a
 * market's first settlement). There is no receipt/event to verify here, so —
 * unlike the other `apply-*.ts` writers — this is NOT an `applyOnChainEffect`
 * call. It is a bare shared-mutation call with a `null` stamp inside a
 * caller-owned transaction: the `applied_by_*` columns stay NULL until the
 * indexer-v3 tail observes the first settlement, whose
 * `ON CONFLICT (market_id) DO NOTHING` makes that tail-write a safe no-op.
 *
 * The upsert SQL is identical by construction with the indexer tail via
 * `@centuari-labs/on-chain-effects` (`applyMarketCreatedMutation`), so the
 * eager path and the tail can't drift (C7).
 */
export async function applyEnsureMarkets(
    pool: Pool,
    markets: MarketCreatedArgs[],
): Promise<void> {
    if (markets.length === 0) return;

    const tx = await pool.connect();
    try {
        await tx.query("BEGIN");
        for (const market of markets) {
            await applyMarketCreatedMutation(tx, market, null);
        }
        await tx.query("COMMIT");
    } catch (err) {
        await tx.query("ROLLBACK");
        throw err;
    } finally {
        tx.release();
    }
}
