/**
 * Centralized smart contract error mapping.
 *
 * Maps known custom-error names and 4-byte selectors found in Viem revert
 * messages to user-friendly descriptions.  The settlement engine maintains a
 * similar mapping in settlement-engine/src/settlement/smartContract.ts — keep
 * both in sync when new errors are added to the contracts.
 *
 * Some errors (e.g. InsufficientFunds) appear in multiple contexts. Callers
 * can pass `overrides` to supply context-specific messages for those cases.
 */

const CONTRACT_ERRORS: Record<string, string> = {
    // ── Centuari / Treasury / Settlement shared ─────────────────────────
    Unauthorized: "Unauthorized: caller does not have permission.",
    ZeroAddress: "Invalid address provided.",
    InvalidAmount: "Invalid amount. Please check the value and try again.",
    ContractPaused: "The contract is currently paused. Please try again later.",

    // ── Centuari ────────────────────────────────────────────────────────
    InvalidMaturity: "Invalid maturity date.",
    NotYetMatured: "This position has not matured yet.",
    BondTokenNotFound: "Bond token not found for this market.",

    // ── Treasury ────────────────────────────────────────────────────────
    InsufficientFunds: "Insufficient balance in Treasury.",

    // ── Settlement ──────────────────────────────────────────────────────
    AlreadySettled: "This match has already been settled.",
    InvalidMatchData: "Invalid match data.",
    EmptyBatch: "Empty batch provided.",

    // ── WithdrawalRegistry ──────────────────────────────────────────────
    WithdrawalBlockedByHF:
        "Withdrawal blocked: it would reduce your health factor below the safe threshold.",
    InsufficientChainLiquidity:
        "Insufficient liquidity on this chain to fulfill the withdrawal right now.",

    // ── OpenZeppelin ────────────────────────────────────────────────────
    EnforcedPause: "The contract is currently paused. Please try again later.",
    ReentrancyGuardReentrantCall: "Transaction conflict. Please try again.",
    AccessControlUnauthorizedAccount:
        "Unauthorized: insufficient role permissions.",
};

const ERROR_SELECTORS: Record<string, string> = {
    "0x82b42900": "Unauthorized",
    "0xd92e233d": "ZeroAddress",
    "0x2c5211c6": "InvalidAmount",
    "0xab35696f": "ContractPaused",
    "0xc7a682c8": "InvalidMaturity",
    "0xca42fe63": "BondTokenNotFound",
    "0x356680b7": "InsufficientFunds",
    "0xb196a44a": "AlreadySettled",
    "0x388cfcc2": "InvalidMatchData",
    "0xc2e5347d": "EmptyBatch",
    "0xd93c0665": "EnforcedPause",
    "0x3ee5aeb5": "ReentrancyGuardReentrantCall",
    "0xe2517d3f": "AccessControlUnauthorizedAccount",
};

/**
 * Parse a Viem contract revert message into a user-friendly string.
 *
 * @param errorMessage  Raw error message from Viem.
 * @param overrides     Optional map of error-name → message for
 *                      context-specific wording (e.g. the caller knows
 *                      we are in a "withdraw" context, not "repay").
 */
export function parseContractError(
    errorMessage: string,
    overrides?: Record<string, string>,
): {
    message: string;
    isKnown: boolean;
} {
    const resolve = (name: string): { message: string; isKnown: true } => ({
        message: overrides?.[name] ?? CONTRACT_ERRORS[name] ?? name,
        isKnown: true,
    });

    // Try matching by error name (Viem often includes the name in the message)
    for (const name of Object.keys(CONTRACT_ERRORS)) {
        if (errorMessage.includes(name)) {
            return resolve(name);
        }
    }

    // Try matching by 4-byte selector
    for (const [selector, name] of Object.entries(ERROR_SELECTORS)) {
        if (errorMessage.includes(selector)) {
            return resolve(name);
        }
    }

    return {
        message: "Blockchain transaction failed. Please try again.",
        isKnown: false,
    };
}
