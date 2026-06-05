import { type Hex, keccak256, toHex } from "viem";

/**
 * `topicFor` is the one backend-local primitive the eager-path `apply-*.ts`
 * helpers still need: it hashes an event signature to its `topics[0]`. The
 * byte conversion (`hexToBytea`) and the idempotency read-check
 * (`isAlreadyStamped`) now live in `@centuari-labs/on-chain-effects`, shared
 * with the indexer tail so the SQL can't drift.
 */

export function topicFor(sig: string): Hex {
    return keccak256(toHex(sig));
}
