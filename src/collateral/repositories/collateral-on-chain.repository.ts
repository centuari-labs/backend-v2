import {
    type IdempotencyStamp,
    applyCollateralFlagSetMutation,
    hexToBytea,
    isAlreadyStamped as sharedIsAlreadyStamped,
} from "@centuari-labs/on-chain-effects";
import { Injectable } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { Hex } from "viem";
import type { CollateralFlagSetArgs } from "../constants";

/**
 * Stamped `user_balance` writes for the `BalanceLedger.CollateralFlagSet`
 * event. Both methods delegate to `@centuari-labs/on-chain-effects` so the SQL
 * is identical *by construction* with the indexer-v3 tail and the other
 * eager-path writers — the Track C7 invariant. A divergent inline copy would
 * break C10 replay idempotency, so do NOT re-inline the upsert here.
 *
 * This thin repository wrapper exists only to honour the backend
 * repository-pattern rule (services never call the shared SQL helpers
 * directly) and to adapt the (user, asset) calling convention. The
 * `core/on-chain-state/apply-*.ts` infra modules call the same shared helpers.
 */
@Injectable()
export class CollateralOnChainRepository {
    /**
     * True when the `user_balance` row for (user, asset) already carries this
     * exact `(txHash, logIndex)` stamp — i.e. the eager path re-ran or the
     * indexer tail got there first. Both paths use this to no-op idempotently.
     */
    isAlreadyStamped(
        tx: PoolClient,
        user: string,
        asset: string,
        stamp: IdempotencyStamp,
    ): Promise<boolean> {
        return sharedIsAlreadyStamped(
            tx,
            "user_balance",
            "user_address = $1 AND asset = $2",
            [hexToBytea(user as Hex), hexToBytea(asset as Hex)],
            stamp,
        );
    }

    /**
     * Upsert `used_as_collateral` + `flagged_at` for the `CollateralFlagSet`
     * event, stamping the idempotency columns. Delegates to the shared
     * `applyCollateralFlagSetMutation` (the single source of truth for this
     * upsert). `CollateralFlagSetArgs` is a superset of the mutation's
     * `CollateralFlagArgs` — it additionally carries `writer` — so it passes
     * straight through.
     */
    async upsertFlag(
        tx: PoolClient,
        args: CollateralFlagSetArgs,
        stamp: IdempotencyStamp,
    ): Promise<void> {
        await applyCollateralFlagSetMutation(tx, args, stamp);
    }
}
