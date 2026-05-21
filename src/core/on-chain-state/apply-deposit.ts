import {
    applyOnChainEffect,
    type ApplyOnChainEffectResult,
} from "@centuari-labs/on-chain-effects";
import { Logger } from "@nestjs/common";
import type { Pool } from "pg";
import {
    type Address,
    type Hex,
    type PublicClient,
    type TransactionReceipt,
    decodeEventLog,
} from "viem";
import { alreadyStamped, hexToBytea, topicFor } from "./apply-internals";

/**
 * Eager-write the effect of a hub deposit onto the shared on-chain-state
 * schema. `HubDepositor.deposit` internally calls `BalanceLedger.credit`,
 * which emits:
 *
 * - `Credited(address writer, address user, address asset, uint256 amount,
 *             uint256 newAvailable)` → increment `user_balance.available`.
 *
 * Keyed by the `Credited` `(txHash, logIndex)` — the SAME event/key indexer-v3's
 * balance-ledger processor stamps — so the eager path and the indexer tail
 * no-op each other (no double credit). NEVER key on `HubDepositor.Deposited`:
 * that is a different `logIndex` in the same tx and would not dedup against the
 * tail. SQL mirrors the indexer tail byte-for-byte
 * ([balance-ledger.processor.handleBalanceDelta](../../../../indexer-v3/src/processors/balance-ledger.processor.ts)).
 *
 * PLACEHOLDER (C4 writer cleanup): this `Credited` listener + insert SQL is a
 * stop-gap. Per the on-chain-effects roadmap it will move into the shared
 * `@centuari-labs/on-chain-effects` library so backend-v2 and indexer-v3 share
 * one implementation; revisit after that refactor.
 */

const logger = new Logger("apply-deposit");

const CREDITED_EVENT = {
    type: "event",
    name: "Credited",
    inputs: [
        { name: "writer", type: "address", indexed: true },
        { name: "user", type: "address", indexed: true },
        { name: "asset", type: "address", indexed: true },
        { name: "amount", type: "uint256", indexed: false },
        { name: "newAvailable", type: "uint256", indexed: false },
    ],
} as const;

const TOPIC_CREDITED = topicFor(
    "Credited(address,address,address,uint256,uint256)",
);

interface CreditedArgs {
    writer: Address;
    user: Address;
    asset: Address;
    amount: bigint;
    newAvailable: bigint;
}

interface ParsedCredited {
    logIndex: number;
    args: CreditedArgs;
}

export interface ApplyDepositArgs {
    pool: Pool;
    client: PublicClient;
    receipt: TransactionReceipt;
    /**
     * Wallet the deposit tx was submitted for. `Credited` logs for a different
     * user are ignored (belt-and-suspenders).
     */
    expectedUser: Address;
}

/**
 * Applies every matching `Credited` log in the receipt. Returns the number of
 * logs newly applied (i.e. not already stamped by a prior run / the tail).
 */
export async function applyDepositEffects(
    args: ApplyDepositArgs,
): Promise<number> {
    const { pool, client, receipt, expectedUser } = args;
    const userLc = expectedUser.toLowerCase();

    const creditedEvents = parseReceiptLogs(receipt, userLc);

    let applied = 0;
    for (const event of creditedEvents) {
        const result = await applyOnChainEffect<CreditedArgs>({
            client,
            pool,
            receipt,
            txHash: receipt.transactionHash,
            expectedEventTopic: TOPIC_CREDITED,
            logIndex: event.logIndex,
            abi: [CREDITED_EVENT],
            expectedArgsPredicate: (decoded) =>
                decoded.user.toLowerCase() === event.args.user.toLowerCase() &&
                decoded.asset.toLowerCase() === event.args.asset.toLowerCase(),
            alreadyAppliedCheck: (tx, stamp) =>
                alreadyStamped(
                    tx,
                    "user_balance",
                    "user_address = $1 AND asset = $2",
                    [hexToBytea(event.args.user), hexToBytea(event.args.asset)],
                    stamp,
                ),
            mutation: async (tx, decoded, stamp) => {
                await tx.query(
                    `INSERT INTO user_balance
                        (user_address, asset, available,
                         used_as_collateral, flagged_at,
                         applied_by_tx_hash, applied_by_log_index,
                         applied_by_block_hash, applied_by_block_number,
                         updated_at)
                     VALUES ($1, $2, $3::numeric, false, 0,
                             $4, $5, $6, $7, now())
                     ON CONFLICT (user_address, asset) DO UPDATE SET
                        available = user_balance.available + EXCLUDED.available,
                        applied_by_tx_hash = EXCLUDED.applied_by_tx_hash,
                        applied_by_log_index = EXCLUDED.applied_by_log_index,
                        applied_by_block_hash = EXCLUDED.applied_by_block_hash,
                        applied_by_block_number = EXCLUDED.applied_by_block_number,
                        updated_at = now()`,
                    [
                        hexToBytea(decoded.user),
                        hexToBytea(decoded.asset),
                        decoded.amount.toString(),
                        hexToBytea(stamp.txHash),
                        stamp.logIndex,
                        hexToBytea(stamp.blockHash),
                        stamp.blockNumber.toString(),
                    ],
                );
            },
        });
        if (result.applied) applied++;
        logOutcome(receipt.transactionHash, event.logIndex, result);
    }

    return applied;
}

function parseReceiptLogs(
    receipt: TransactionReceipt,
    expectedUserLc: string,
): ParsedCredited[] {
    const creditedEvents: ParsedCredited[] = [];

    for (const log of receipt.logs) {
        const topic0 = log.topics[0];
        if (!topic0) continue;
        if (topic0.toLowerCase() !== TOPIC_CREDITED.toLowerCase()) continue;

        try {
            const decoded = decodeEventLog({
                abi: [CREDITED_EVENT],
                data: log.data,
                topics: log.topics,
            });
            const typed = decoded.args as unknown as CreditedArgs;
            if (typed.user.toLowerCase() !== expectedUserLc) continue;
            creditedEvents.push({ logIndex: log.logIndex, args: typed });
        } catch {
            // Ignore undecodable logs — a non-Credited log sharing the topic
            // shape would surface as event_missing/args_mismatch downstream.
        }
    }

    return creditedEvents;
}

function logOutcome(
    txHash: Hex,
    logIndex: number,
    result: ApplyOnChainEffectResult,
): void {
    if (result.applied) return;
    if (result.reason === "already_stamped") {
        logger.debug(
            "deposit Credited already stamped " +
                `(txHash=${txHash} logIndex=${logIndex})`,
        );
        return;
    }
    logger.warn(
        "deposit Credited not applied " +
            `(txHash=${txHash} logIndex=${logIndex} reason=${result.reason})`,
    );
}
