import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../../core/database/database.service";

@Injectable()
export class PendingCollateralFlagsRepository {
    constructor(private readonly databaseService: DatabaseService) {}

    /**
     * Idempotent enqueue. Re-issuing a flag request for the same (user, asset)
     * is a no-op rather than an error. Caller is responsible for the
     * `countForWallet` cap check before invoking.
     */
    async enqueue(walletAddress: string, asset: string): Promise<void> {
        await this.databaseService.query(
            `INSERT INTO pending_collateral_flags (user_address, asset)
             VALUES ($1, $2)
             ON CONFLICT (user_address, asset) DO NOTHING`,
            [hexToBytea(walletAddress), hexToBytea(asset)],
        );
    }

    /**
     * Removes a queue row if present. Returns true when a row was actually
     * deleted (signals the unflag was a pure backend op with no on-chain
     * action needed). Returns false when nothing was queued — caller must
     * fall through to the on-chain unflag path.
     */
    async dequeue(walletAddress: string, asset: string): Promise<boolean> {
        const result = await this.databaseService.query<{ count: string }>(
            `WITH deleted AS (
                DELETE FROM pending_collateral_flags
                  WHERE user_address = $1 AND asset = $2
                  RETURNING 1
             )
             SELECT COUNT(*)::text AS count FROM deleted`,
            [hexToBytea(walletAddress), hexToBytea(asset)],
        );
        return Number(result[0]?.count ?? "0") > 0;
    }

    /**
     * Returns the number of pending flag rows for a wallet. Used by the
     * service to enforce `COLLATERAL_QUEUE_CAP_PER_WALLET` before each new
     * enqueue.
     */
    async countForWallet(walletAddress: string): Promise<number> {
        const result = await this.databaseService.query<{ count: string }>(
            `SELECT COUNT(*)::text AS count
               FROM pending_collateral_flags
              WHERE user_address = $1`,
            [hexToBytea(walletAddress)],
        );
        return Number(result[0]?.count ?? "0");
    }

    /**
     * Returns lowercase hex-prefixed asset addresses currently queued for the
     * wallet. Used by portfolio reads to render the "Pending" badge in
     * Phase 5 (or by an indexer-v3 LEFT JOIN — whichever home wins during
     * implementation).
     */
    async readForWallet(walletAddress: string): Promise<string[]> {
        const rows = await this.databaseService.query<{ asset: Buffer }>(
            `SELECT asset
               FROM pending_collateral_flags
              WHERE user_address = $1
              ORDER BY created_at ASC`,
            [hexToBytea(walletAddress)],
        );
        return rows.map((row) => byteaToHex(row.asset));
    }
}

function hexToBytea(hex: string): Buffer {
    const stripped = hex.startsWith("0x") ? hex.slice(2) : hex;
    if (stripped.length % 2 !== 0) {
        throw new Error(`hexToBytea: odd-length hex ${hex}`);
    }
    return Buffer.from(stripped, "hex");
}

function byteaToHex(buf: Buffer): string {
    return `0x${buf.toString("hex")}`;
}
