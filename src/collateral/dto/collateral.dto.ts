import { IsString, Matches } from "class-validator";

/**
 * Body for `POST /collateral/flag`. Backend always enqueues — never submits
 * on-chain. Frontend uses `wagmi.writeContract({ functionName: "flag" })`
 * directly for the emergency immediate-flag path (Phase 5), bypassing the
 * backend entirely.
 */
export class FlagCollateralDto {
    @IsString()
    @Matches(/^0x[a-fA-F0-9]{40}$/, { message: "invalid asset address" })
    asset: string;
}

/**
 * Body for `POST /collateral/unflag`. Backend either dequeues a pending
 * row (no on-chain action) or submits `CollateralManager.unflagFor` with
 * the operator key (subject to Redis rate-limit + RiskModule pre-check).
 */
export class UnflagCollateralDto {
    @IsString()
    @Matches(/^0x[a-fA-F0-9]{40}$/, { message: "invalid asset address" })
    asset: string;
}

export type CollateralMutationResponse =
    | { queued: true }
    | { dequeued: true }
    | { applied: true; txHash: string }
    | { applied: false; reason: string };
