import {
    type ApplyOnChainEffectResult,
    applyCreditedMutation,
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
 * tail. The SQL mutation is shared by construction with the indexer tail via
 * `@centuari-labs/on-chain-effects` (`applyCreditedMutation`), so the eager
 * path and tail can't drift.
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
    /**
     * Canonical `BalanceLedger` proxy address. Only `Credited` logs emitted by
     * this exact contract are applied — a log carrying the same topic shape from
     * any other (attacker-controlled) contract in the same receipt is rejected.
     */
    balanceLedgerAddress: Address;
}

/**
 * Applies every matching `Credited` log in the receipt. Returns the number of
 * logs newly applied (i.e. not already stamped by a prior run / the tail).
 */
export async function applyDepositEffects(
    args: ApplyDepositArgs,
): Promise<number> {
    const { pool, client, receipt, expectedUser, balanceLedgerAddress } = args;
    const userLc = expectedUser.toLowerCase();
    const ledgerLc = balanceLedgerAddress.toLowerCase();

    const creditedEvents = parseReceiptLogs(receipt, userLc, ledgerLc);

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
                isAlreadyStamped(
                    tx,
                    "user_balance",
                    "user_address = $1 AND asset = $2",
                    [hexToBytea(event.args.user), hexToBytea(event.args.asset)],
                    stamp,
                ),
            mutation: async (tx, decoded, stamp) => {
                await applyCreditedMutation(tx, decoded, stamp);
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
    balanceLedgerLc: string,
): ParsedCredited[] {
    const creditedEvents: ParsedCredited[] = [];

    for (const log of receipt.logs) {
        const topic0 = log.topics[0];
        if (!topic0) continue;
        if (topic0.toLowerCase() !== TOPIC_CREDITED.toLowerCase()) continue;
        // Reject Credited logs from any contract other than the canonical
        // BalanceLedger — a spoofed log sharing the topic shape must not credit.
        if (log.address.toLowerCase() !== balanceLedgerLc) continue;

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
