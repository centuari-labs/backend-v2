import { Injectable } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { Hex } from "viem";
import type { CollateralFlagSetArgs } from "../constants";
import type { IdempotencyStamp } from "@centuari/indexer-v3/shared/apply-on-chain-effect";

/**
 * Raw SQL against the indexer-v3 shared schema. The mutation mirrors
 * balance-ledger.processor.ts in indexer-v3 so the eager path and the
 * indexer tail cannot diverge.
 */
@Injectable()
export class CollateralOnChainRepository {
    async isAlreadyStamped(
        tx: PoolClient,
        user: string,
        asset: string,
        txHash: Hex,
        logIndex: number,
    ): Promise<boolean> {
        const res = await tx.query(
            `SELECT 1 FROM user_balance
              WHERE user_address = $1 AND asset = $2
                AND applied_by_tx_hash = $3 AND applied_by_log_index = $4`,
            [hexToBytea(user), hexToBytea(asset), hexToBytea(txHash), logIndex],
        );
        return (res.rowCount ?? 0) > 0;
    }

    async upsertFlag(
        tx: PoolClient,
        args: CollateralFlagSetArgs,
        stamp: IdempotencyStamp,
    ): Promise<void> {
        await tx.query(
            `INSERT INTO user_balance
                (user_address, asset, used_as_collateral, flagged_at,
                 applied_by_tx_hash, applied_by_log_index,
                 applied_by_block_hash, applied_by_block_number, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
             ON CONFLICT (user_address, asset) DO UPDATE SET
                used_as_collateral = EXCLUDED.used_as_collateral,
                flagged_at = EXCLUDED.flagged_at,
                applied_by_tx_hash = EXCLUDED.applied_by_tx_hash,
                applied_by_log_index = EXCLUDED.applied_by_log_index,
                applied_by_block_hash = EXCLUDED.applied_by_block_hash,
                applied_by_block_number = EXCLUDED.applied_by_block_number,
                updated_at = now()`,
            [
                hexToBytea(args.user),
                hexToBytea(args.asset),
                args.used,
                args.flaggedAt.toString(),
                hexToBytea(stamp.txHash),
                stamp.logIndex,
                hexToBytea(stamp.blockHash),
                stamp.blockNumber.toString(),
            ],
        );
    }
}

function hexToBytea(hex: string): Buffer {
    const stripped = hex.startsWith("0x") ? hex.slice(2) : hex;
    if (stripped.length % 2 !== 0) {
        throw new Error(`hexToBytea: odd-length hex ${hex}`);
    }
    return Buffer.from(stripped, "hex");
}
