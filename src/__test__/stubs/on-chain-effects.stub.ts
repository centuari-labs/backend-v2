/**
 * Stub for `@centuari-labs/on-chain-effects`, wired in via Jest's
 * `moduleNameMapper` so backend-v2 unit tests can load source files that
 * import from the package without Jest's CJS runtime trying to execute the
 * package's ESM `dist/index.js` (which errors with `SyntaxError:
 * Unexpected token 'export'`).
 *
 * The real helpers are covered by dedicated tests in `on-chain-effects/`
 * (the package's own suite) and by backend-v2's apply-*.test.ts files,
 * which jest.mock('@centuari-labs/on-chain-effects') to control this
 * stub's `applyOnChainEffect` export per test. For every other suite this
 * module just has to expose the named bindings so `import` statements
 * resolve.
 */

import type { Pool, PoolClient } from "pg";
import type { Hex, PublicClient, TransactionReceipt } from "viem";

export interface IdempotencyStamp {
    txHash: Hex;
    logIndex: number;
    blockHash: Hex;
    blockNumber: bigint;
}

export interface ApplyOnChainEffectArgs<TArgs> {
    client?: PublicClient;
    pool: Pool;
    txHash: Hex;
    receipt?: TransactionReceipt;
    expectedEventTopic: Hex;
    logIndex?: number;
    abi: readonly unknown[];
    expectedArgsPredicate: (decoded: TArgs) => boolean;
    mutation: (
        tx: PoolClient,
        decoded: TArgs,
        stamp: IdempotencyStamp,
    ) => Promise<void>;
    alreadyAppliedCheck?: (
        tx: PoolClient,
        stamp: IdempotencyStamp,
    ) => Promise<boolean>;
}

export type ApplyOnChainEffectResult =
    | { applied: true }
    | {
          applied: false;
          reason:
              | "already_stamped"
              | "receipt_reverted"
              | "event_missing"
              | "args_mismatch";
      };

/**
 * Default stub: returns `{ applied: false, reason: "event_missing" }`.
 * Tests that need to exercise the helper's behaviour should
 * `jest.mock("@centuari-labs/on-chain-effects")` and override this mock.
 */
export const applyOnChainEffect = jest.fn(
    async <_TArgs>(
        _args: ApplyOnChainEffectArgs<_TArgs>,
    ): Promise<ApplyOnChainEffectResult> => ({
        applied: false,
        reason: "event_missing" as const,
    }),
);

/**
 * The byte/stamp helpers and per-event mutation functions the eager-path
 * `apply-*.ts` modules import from the package. The real implementations live
 * in `on-chain-effects/src/mutations.ts` and are covered by that package's own
 * tests; here we only need the named bindings to resolve at runtime. The
 * mutation fns are `jest.fn()`s because `applyOnChainEffect` (above) never
 * invokes the `mutation` callback in unit tests — suites that want to assert
 * mutation behaviour override these directly.
 */
export const hexToBytea = (hex: Hex): Buffer => {
    const stripped = hex.startsWith("0x") ? hex.slice(2) : hex;
    if (stripped.length % 2 !== 0) {
        throw new Error(`hexToBytea: odd-length hex ${hex}`);
    }
    return Buffer.from(stripped, "hex");
};

export const isAlreadyStamped = jest.fn(
    async (
        _tx: PoolClient,
        _table: string,
        _pkCondition: string,
        _pkValues: readonly unknown[],
        _stamp: IdempotencyStamp,
    ): Promise<boolean> => false,
);

export const applyCreditedMutation = jest.fn(
    async (
        _tx: PoolClient,
        _decoded: unknown,
        _stamp: IdempotencyStamp,
    ): Promise<number> => 1,
);

export const applyDebitedMutation = jest.fn(
    async (
        _tx: PoolClient,
        _decoded: unknown,
        _stamp: IdempotencyStamp,
    ): Promise<number> => 1,
);

export const applyRepaidMutation = jest.fn(
    async (
        _tx: PoolClient,
        _decoded: unknown,
        _stamp: IdempotencyStamp,
    ): Promise<number> => 1,
);

export const applyLendPositionWithdrawnMutation = jest.fn(
    async (
        _tx: PoolClient,
        _decoded: unknown,
        _stamp: IdempotencyStamp,
    ): Promise<number> => 1,
);

export interface MarketCreatedArgs {
    marketId: Hex;
    loanToken: Hex;
    maturity: bigint;
}

/**
 * `market` is the one mutation with a NULLABLE stamp: the backend registers
 * markets on a cron before any `MarketCreated` event exists (eager path passes
 * `null`); the indexer tail passes a real stamp. See the package's own tests.
 */
export const applyMarketCreatedMutation = jest.fn(
    async (
        _tx: PoolClient,
        _decoded: MarketCreatedArgs,
        _stamp: IdempotencyStamp | null,
    ): Promise<number> => 1,
);
