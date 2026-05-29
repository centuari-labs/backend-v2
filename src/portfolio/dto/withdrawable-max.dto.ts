import { IsUUID } from "class-validator";

/** Query for `GET /portfolio/withdrawable-max` — a single asset UUID. */
export class WithdrawableMaxQueryDto {
    @IsUUID()
    assetId: string;
}

/**
 * HF-aware withdrawal limits for one asset, for the authenticated user.
 *
 * UX read only — the authoritative gate stays `withdraw.service` + the
 * on-chain `RiskModule`. `currentHealthFactor` is `null` when the user has no
 * debt (JSON cannot carry `Infinity` — it serializes to `null` — and the
 * frontend type is already `number | null`). The `*BaseUnits` strings are
 * authoritative; the human fields are display-only.
 */
export class WithdrawableMaxResponseDto {
    assetId: string;
    /** Mirrors `user_balance.used_as_collateral`. */
    isCollateral: boolean;
    /** Available balance in base units (the withdrawal cap). */
    availableBalanceBaseUnits: string;
    /** Available balance, human-readable. */
    availableBalance: string;
    /** Current health factor; `null` when the user has no debt. */
    currentHealthFactor: number | null;
    /**
     * Largest amount (base units) withdrawable while keeping
     * `HF >= 1 + bufferBps/10000`. Equals `availableBalanceBaseUnits` when the
     * asset is not collateral or the user has no debt.
     */
    maxWithdrawableBaseUnits: string;
    /** `maxWithdrawableBaseUnits`, human-readable. */
    maxWithdrawable: string;
    /**
     * Off-chain pre-check: true when the entire collateral position can be
     * removed while keeping `HF >= 1 + bufferBps/10000` (i.e.
     * `maxWithdrawable >= available`). The on-chain `RiskModule.canUnflag`
     * remains the enforcement backstop for direct-to-contract callers.
     */
    canUnflag: boolean;
    /** Safety buffer (basis points) applied above HF=1. */
    bufferBps: number;
}
