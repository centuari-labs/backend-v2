import { keccak256, toHex } from "viem";

// ============ Numeric policy constants ============

/**
 * Hard cap on the number of pending collateral flag rows a single wallet can
 * accumulate. Bounds settlement-engine gas (each queued asset becomes a
 * `markCollateral` SSTORE inside `Centuari.settleMatch`) and prevents
 * diversification spam. Generous relative to the ~11 tokens Centuari
 * currently supports.
 */
export const COLLATERAL_QUEUE_CAP_PER_WALLET = 20;

/**
 * Combined rate-limit budget covering every backend-mediated collateral
 * mutation (flag enqueue, unflag dequeue, on-chain unflag submit). Single
 * key namespace `collateral:write:${wallet}`.
 */
export const RATE_LIMIT_BUDGET = 10;

/**
 * Rate-limit window in seconds. 24 hours.
 */
export const RATE_LIMIT_WINDOW_SECONDS = 86_400;

// ============ CollateralManager event ABI ============

/**
 * 5-param shape emitted by BalanceLedger when CollateralManager flags or
 * unflags an asset for a user. Used by `applyOnChainEffect` to validate
 * receipts after backend-direct submission.
 */
export const COLLATERAL_FLAG_SET_ABI = [
    {
        type: "event",
        name: "CollateralFlagSet",
        inputs: [
            { name: "writer", type: "address", indexed: true },
            { name: "user", type: "address", indexed: true },
            { name: "asset", type: "address", indexed: true },
            { name: "used", type: "bool", indexed: false },
            { name: "flaggedAt", type: "uint64", indexed: false },
        ],
    },
] as const;

export const COLLATERAL_FLAG_SET_TOPIC0 = keccak256(
    toHex("CollateralFlagSet(address,address,address,bool,uint64)"),
);

export interface CollateralFlagSetArgs {
    writer: `0x${string}`;
    user: `0x${string}`;
    asset: `0x${string}`;
    used: boolean;
    flaggedAt: bigint;
}

// ============ CollateralManager write ABI (operator path only) ============

/**
 * Write fragments the backend uses against `CollateralManager`. Backend only
 * ever calls `unflagFor` (operator path) — `flag(asset)` and `unflag(asset)`
 * direct paths are reserved for frontend wagmi calls (Phase 5). `flagFor` is
 * defined here for completeness even though Phase 2 backend never calls it
 * (queue-only flag).
 */
export const COLLATERAL_MANAGER_WRITE_ABI = [
    {
        type: "function",
        name: "flagFor",
        stateMutability: "nonpayable",
        inputs: [
            { name: "user", type: "address" },
            { name: "asset", type: "address" },
        ],
        outputs: [],
    },
    {
        type: "function",
        name: "unflagFor",
        stateMutability: "nonpayable",
        inputs: [
            { name: "user", type: "address" },
            { name: "asset", type: "address" },
        ],
        outputs: [],
    },
    // Custom errors so viem can decode reverts off the on-chain trace.
    { type: "error", name: "NotFlagged", inputs: [] },
    {
        type: "error",
        name: "FlagLockActive",
        inputs: [{ name: "unlocksAt", type: "uint64" }],
    },
    { type: "error", name: "WouldMakeUnhealthy", inputs: [] },
    { type: "error", name: "NotOperator", inputs: [] },
] as const;

// ============ RiskModule view ABI (canUnflag pre-check) ============

export const RISK_MODULE_VIEW_ABI = [
    {
        type: "function",
        name: "canUnflag",
        stateMutability: "view",
        inputs: [
            { name: "user", type: "address" },
            { name: "asset", type: "address" },
        ],
        outputs: [{ name: "", type: "bool" }],
    },
] as const;
