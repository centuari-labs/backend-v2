import {
    type ApplyOnChainEffectResult,
    applyDebitedMutation,
    applyOnChainEffect,
    applyRepaidMutation,
    hexToBytea,
    isAlreadyStamped,
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
import { topicFor } from "./apply-internals";

/**
 * Eager-write the effects of `Centuari.repay(marketId, borrower, token,
 * amount)` onto the shared on-chain-state schema:
 *
 * - `Repaid(bytes32, address, uint256)`  → decrement `borrow_position.debt`.
 * - `Debited(address writer, address user, address asset, uint256 amount,
 *            uint256 newAvailable)`       → decrement `user_balance.available`.
 *
 * SQL mutations are shared by construction with the indexer tail via
 * `@centuari-labs/on-chain-effects` (`applyRepaidMutation` /
 * `applyDebitedMutation`), so the eager path and tail can't drift.
 *
 * Every matching log gets its own `applyOnChainEffect` call scoped to its
 * `logIndex`, so a tx that emits multiple matching logs is applied in full
 * rather than collapsed to the first one. Logs are pre-decoded here so each
 * call can pass the row PK into `alreadyAppliedCheck` (the helper runs that
 * callback before mutation, so the PK values must be known up front).
 */

const logger = new Logger("apply-repay");

const REPAID_EVENT = {
    type: "event",
    name: "Repaid",
    inputs: [
        { name: "marketId", type: "bytes32", indexed: true },
        { name: "borrower", type: "address", indexed: true },
        { name: "amount", type: "uint256", indexed: false },
    ],
} as const;

const DEBITED_EVENT = {
    type: "event",
    name: "Debited",
    inputs: [
        { name: "writer", type: "address", indexed: true },
        { name: "user", type: "address", indexed: true },
        { name: "asset", type: "address", indexed: true },
        { name: "amount", type: "uint256", indexed: false },
        { name: "newAvailable", type: "uint256", indexed: false },
    ],
} as const;

const TOPIC_REPAID = topicFor("Repaid(bytes32,address,uint256)");
const TOPIC_DEBITED = topicFor(
    "Debited(address,address,address,uint256,uint256)",
);

interface RepaidArgs {
    marketId: Hex;
    borrower: Address;
    amount: bigint;
}

interface DebitedArgs {
    writer: Address;
    user: Address;
    asset: Address;
    amount: bigint;
    newAvailable: bigint;
}

interface ParsedRepaid {
    logIndex: number;
    args: RepaidArgs;
}

interface ParsedDebited {
    logIndex: number;
    args: DebitedArgs;
}

export interface ApplyRepayArgs {
    pool: Pool;
    client: PublicClient;
    receipt: TransactionReceipt;
    /**
     * Borrower the tx was submitted for. `Repaid` logs for a different
     * borrower are rejected (shouldn't happen, but belt-and-suspenders).
     */
    expectedBorrower: Address;
}

export async function applyRepayEffects(args: ApplyRepayArgs): Promise<void> {
    const { pool, client, receipt, expectedBorrower } = args;
    const borrowerLc = expectedBorrower.toLowerCase();

    const { repaidEvents, debitedEvents } = parseReceiptLogs(
        receipt,
        borrowerLc,
    );

    for (const event of repaidEvents) {
        const result = await applyOnChainEffect<RepaidArgs>({
            client,
            pool,
            receipt,
            txHash: receipt.transactionHash,
            expectedEventTopic: TOPIC_REPAID,
            logIndex: event.logIndex,
            abi: [REPAID_EVENT],
            expectedArgsPredicate: (decoded) =>
                decoded.marketId.toLowerCase() ===
                    event.args.marketId.toLowerCase() &&
                decoded.borrower.toLowerCase() ===
                    event.args.borrower.toLowerCase(),
            alreadyAppliedCheck: (tx, stamp) =>
                isAlreadyStamped(
                    tx,
                    "borrow_position",
                    "market_id = $1 AND borrower = $2",
                    [
                        hexToBytea(event.args.marketId),
                        hexToBytea(event.args.borrower),
                    ],
                    stamp,
                ),
            mutation: async (tx, decoded, stamp) => {
                await applyRepaidMutation(tx, decoded, stamp);
            },
        });
        logOutcome(receipt.transactionHash, "Repaid", event.logIndex, result);
    }

    for (const event of debitedEvents) {
        const result = await applyOnChainEffect<DebitedArgs>({
            client,
            pool,
            receipt,
            txHash: receipt.transactionHash,
            expectedEventTopic: TOPIC_DEBITED,
            logIndex: event.logIndex,
            abi: [DEBITED_EVENT],
            expectedArgsPredicate: (decoded) =>
                decoded.user.toLowerCase() === event.args.user.toLowerCase() &&
                decoded.asset.toLowerCase() === event.args.asset.toLowerCase(),
            alreadyAppliedCheck: (tx, stamp) =>
                isAlreadyStamped(
                    tx,
                    "user_balance",
                    "user_address = $1 AND asset = $2",
                    [hexToBytea(event.args.user), hexToBytea(event.args.asset)],
                    stamp,
                ),
            mutation: async (tx, decoded, stamp) => {
                await applyDebitedMutation(tx, decoded, stamp);
            },
        });
        logOutcome(receipt.transactionHash, "Debited", event.logIndex, result);
    }
}

function parseReceiptLogs(
    receipt: TransactionReceipt,
    expectedUserLc: string,
): { repaidEvents: ParsedRepaid[]; debitedEvents: ParsedDebited[] } {
    const repaidEvents: ParsedRepaid[] = [];
    const debitedEvents: ParsedDebited[] = [];

    for (const log of receipt.logs) {
        const topic0 = log.topics[0];
        if (!topic0) continue;

        if (topic0.toLowerCase() === TOPIC_REPAID.toLowerCase()) {
            try {
                const decoded = decodeEventLog({
                    abi: [REPAID_EVENT],
                    data: log.data,
                    topics: log.topics,
                });
                const typed = decoded.args as unknown as RepaidArgs;
                if (typed.borrower.toLowerCase() !== expectedUserLc) continue;
                repaidEvents.push({ logIndex: log.logIndex, args: typed });
            } catch {
                // Ignore undecodable logs — the helper will report
                // `event_missing` / `args_mismatch` if anything downstream
                // needs the row.
            }
        } else if (topic0.toLowerCase() === TOPIC_DEBITED.toLowerCase()) {
            try {
                const decoded = decodeEventLog({
                    abi: [DEBITED_EVENT],
                    data: log.data,
                    topics: log.topics,
                });
                const typed = decoded.args as unknown as DebitedArgs;
                if (typed.user.toLowerCase() !== expectedUserLc) continue;
                debitedEvents.push({ logIndex: log.logIndex, args: typed });
            } catch {
                // ditto
            }
        }
    }

    return { repaidEvents, debitedEvents };
}

function logOutcome(
    txHash: Hex,
    eventName: "Repaid" | "Debited",
    logIndex: number,
    result: ApplyOnChainEffectResult,
): void {
    if (result.applied) return;
    if (result.reason === "already_stamped") {
        logger.debug(
            `repay ${eventName} already stamped ` +
                `(txHash=${txHash} logIndex=${logIndex})`,
        );
        return;
    }
    logger.warn(
        `repay ${eventName} not applied ` +
            `(txHash=${txHash} logIndex=${logIndex} reason=${result.reason})`,
    );
}
