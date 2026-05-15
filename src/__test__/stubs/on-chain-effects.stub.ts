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
