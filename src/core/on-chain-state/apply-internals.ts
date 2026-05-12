import type { IdempotencyStamp } from "@centuari-labs/on-chain-effects";
import type { PoolClient } from "pg";
import { type Hex, keccak256, toHex } from "viem";

/**
 * Shared primitives for the eager-path `applyOnChainEffect` helpers. Kept
 * separate from the per-event modules so the SQL-mirror check (eager vs
 * indexer tail) is a single-file read.
 */

export function topicFor(sig: string): Hex {
    return keccak256(toHex(sig));
}

export function hexToBytea(hex: string): Buffer {
    const stripped = hex.startsWith("0x") ? hex.slice(2) : hex;
    if (stripped.length % 2 !== 0) {
        throw new Error(`hexToBytea: odd-length hex ${hex}`);
    }
    return Buffer.from(stripped.toLowerCase(), "hex");
}

/**
 * Returns true when the target row is already stamped with this exact
 * `(tx_hash, log_index)` tuple — meaning either the eager path re-ran for
 * the same event or the indexer tail got there first.
 */
export async function alreadyStamped(
    tx: PoolClient,
    table: "user_balance" | "lend_position" | "borrow_position" | "market",
    pkCondition: string,
    pkValues: readonly unknown[],
    stamp: IdempotencyStamp,
): Promise<boolean> {
    const res = await tx.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM ${table}
          WHERE ${pkCondition}
            AND applied_by_tx_hash = $${pkValues.length + 1}
            AND applied_by_log_index = $${pkValues.length + 2}`,
        [...pkValues, hexToBytea(stamp.txHash), stamp.logIndex],
    );
    return Boolean(res.rows[0] && Number(res.rows[0].count) > 0);
}
