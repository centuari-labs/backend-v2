import {
    type ApplyOnChainEffectResult,
    applyDebitedMutation,
    applyOnChainEffect,
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
 * Eager-write the effect of `HubDepositor.payout(user, asset, amount)`:
 *
 * - `Debited(address writer, address user, address asset, uint256 amount,
 *            uint256 newAvailable)` → decrement `user_balance.available`.
 *
 * `HubDepositor.payout` is the only on-chain entry point this helper covers
 * today. It triggers `BalanceLedger.debit`, which emits `Debited`. The SQL
 * mutation is shared by construction with the indexer tail via
 * `@centuari-labs/on-chain-effects` (`applyDebitedMutation`), so the eager
 * path and tail can't drift.
 */

const logger = new Logger("apply-withdraw");

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

const TOPIC_DEBITED = topicFor(
    "Debited(address,address,address,uint256,uint256)",
);

interface DebitedArgs {
    writer: Address;
    user: Address;
    asset: Address;
    amount: bigint;
    newAvailable: bigint;
}

interface ParsedDebited {
    logIndex: number;
    args: DebitedArgs;
}

export interface ApplyWithdrawArgs {
    pool: Pool;
    client: PublicClient;
    receipt: TransactionReceipt;
    /** User the tx was submitted for. Logs for other users are ignored. */
    expectedUser: Address;
}

export async function applyWithdrawEffects(
    args: ApplyWithdrawArgs,
): Promise<void> {
    const { pool, client, receipt, expectedUser } = args;
    const userLc = expectedUser.toLowerCase();

    const debitedEvents = parseReceiptLogs(receipt, userLc);

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
        logOutcome(receipt.transactionHash, event.logIndex, result);
    }
}

function parseReceiptLogs(
    receipt: TransactionReceipt,
    expectedUserLc: string,
): ParsedDebited[] {
    const debitedEvents: ParsedDebited[] = [];

    for (const log of receipt.logs) {
        const topic0 = log.topics[0];
        if (!topic0) continue;
        if (topic0.toLowerCase() !== TOPIC_DEBITED.toLowerCase()) continue;

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
            // Ignore undecodable logs — the helper will report
            // `event_missing` / `args_mismatch` if anything downstream
            // needs the row.
        }
    }

    return debitedEvents;
}

function logOutcome(
    txHash: Hex,
    logIndex: number,
    result: ApplyOnChainEffectResult,
): void {
    if (result.applied) return;
    if (result.reason === "already_stamped") {
        logger.debug(
            "withdraw Debited already stamped " +
                `(txHash=${txHash} logIndex=${logIndex})`,
        );
        return;
    }
    logger.warn(
        "withdraw Debited not applied " +
            `(txHash=${txHash} logIndex=${logIndex} reason=${result.reason})`,
    );
}
