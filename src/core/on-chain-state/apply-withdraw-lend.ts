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
 * Eager-write the effects of
 * `Centuari.withdrawLendPosition(marketId, loanToken, maturity, cbtAmount)`:
 *
 * - `LendPositionWithdrawn(bytes32, address, uint256 cbtBurned,
 *                          uint256 amountWithdrawn)`
 *      → decrement `lend_position.cbt_balance` and `lend_position.principal`.
 * - `Credited(address writer, address user, address asset, uint256 amount,
 *             uint256 newAvailable)`
 *      → increment `user_balance.available`.
 *
 * SQL mutations mirror
 * [centuari.processor.handleLendPositionWithdrawn](../../../../indexer-v3/src/processors/centuari.processor.ts)
 * and
 * [balance-ledger.processor.handleBalanceDelta](../../../../indexer-v3/src/processors/balance-ledger.processor.ts).
 * The eager path and indexer tail must stay byte-for-byte identical.
 */

const logger = new Logger("apply-withdraw-lend");

const LEND_POSITION_WITHDRAWN_EVENT = {
    type: "event",
    name: "LendPositionWithdrawn",
    inputs: [
        { name: "marketId", type: "bytes32", indexed: true },
        { name: "lender", type: "address", indexed: true },
        { name: "cbtBurned", type: "uint256", indexed: false },
        { name: "amountWithdrawn", type: "uint256", indexed: false },
    ],
} as const;

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

const TOPIC_LEND_POSITION_WITHDRAWN = topicFor(
    "LendPositionWithdrawn(bytes32,address,uint256,uint256)",
);
const TOPIC_CREDITED = topicFor(
    "Credited(address,address,address,uint256,uint256)",
);

interface LendPositionWithdrawnArgs {
    marketId: Hex;
    lender: Address;
    cbtBurned: bigint;
    amountWithdrawn: bigint;
}

interface CreditedArgs {
    writer: Address;
    user: Address;
    asset: Address;
    amount: bigint;
    newAvailable: bigint;
}

interface ParsedWithdrawn {
    logIndex: number;
    args: LendPositionWithdrawnArgs;
}

interface ParsedCredited {
    logIndex: number;
    args: CreditedArgs;
}

export interface ApplyWithdrawLendArgs {
    pool: Pool;
    client: PublicClient;
    receipt: TransactionReceipt;
    /** Lender the tx was submitted for. Logs for other lenders are ignored. */
    expectedLender: Address;
}

export async function applyWithdrawLendEffects(
    args: ApplyWithdrawLendArgs,
): Promise<void> {
    const { pool, client, receipt, expectedLender } = args;
    const lenderLc = expectedLender.toLowerCase();

    const { withdrawnEvents, creditedEvents } = parseReceiptLogs(
        receipt,
        lenderLc,
    );

    for (const event of withdrawnEvents) {
        const result = await applyOnChainEffect<LendPositionWithdrawnArgs>({
            client,
            pool,
            receipt,
            txHash: receipt.transactionHash,
            expectedEventTopic: TOPIC_LEND_POSITION_WITHDRAWN,
            logIndex: event.logIndex,
            abi: [LEND_POSITION_WITHDRAWN_EVENT],
            expectedArgsPredicate: (decoded) =>
                decoded.marketId.toLowerCase() ===
                    event.args.marketId.toLowerCase() &&
                decoded.lender.toLowerCase() ===
                    event.args.lender.toLowerCase(),
            alreadyAppliedCheck: (tx, stamp) =>
                alreadyStamped(
                    tx,
                    "lend_position",
                    "market_id = $1 AND lender = $2",
                    [
                        hexToBytea(event.args.marketId),
                        hexToBytea(event.args.lender),
                    ],
                    stamp,
                ),
            mutation: async (tx, decoded, stamp) => {
                await tx.query(
                    `UPDATE lend_position
                        SET cbt_balance = GREATEST(cbt_balance - $3::numeric, 0),
                            principal   = GREATEST(principal   - $4::numeric, 0),
                            applied_by_tx_hash = $5,
                            applied_by_log_index = $6,
                            applied_by_block_hash = $7,
                            applied_by_block_number = $8,
                            updated_at = now()
                      WHERE market_id = $1 AND lender = $2 AND cbt_balance > 0`,
                    [
                        hexToBytea(decoded.marketId),
                        hexToBytea(decoded.lender),
                        decoded.cbtBurned.toString(),
                        decoded.amountWithdrawn.toString(),
                        hexToBytea(stamp.txHash),
                        stamp.logIndex,
                        hexToBytea(stamp.blockHash),
                        stamp.blockNumber.toString(),
                    ],
                );
            },
        });
        logOutcome(
            receipt.transactionHash,
            "LendPositionWithdrawn",
            event.logIndex,
            result,
        );
    }

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
                decoded.user.toLowerCase() ===
                    event.args.user.toLowerCase() &&
                decoded.asset.toLowerCase() ===
                    event.args.asset.toLowerCase(),
            alreadyAppliedCheck: (tx, stamp) =>
                alreadyStamped(
                    tx,
                    "user_balance",
                    "user_address = $1 AND asset = $2",
                    [
                        hexToBytea(event.args.user),
                        hexToBytea(event.args.asset),
                    ],
                    stamp,
                ),
            mutation: async (tx, decoded, stamp) => {
                const delta = decoded.amount.toString();
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
                        delta,
                        hexToBytea(stamp.txHash),
                        stamp.logIndex,
                        hexToBytea(stamp.blockHash),
                        stamp.blockNumber.toString(),
                    ],
                );
            },
        });
        logOutcome(
            receipt.transactionHash,
            "Credited",
            event.logIndex,
            result,
        );
    }
}

function parseReceiptLogs(
    receipt: TransactionReceipt,
    expectedUserLc: string,
): { withdrawnEvents: ParsedWithdrawn[]; creditedEvents: ParsedCredited[] } {
    const withdrawnEvents: ParsedWithdrawn[] = [];
    const creditedEvents: ParsedCredited[] = [];

    for (const log of receipt.logs) {
        const topic0 = log.topics[0];
        if (!topic0) continue;

        if (
            topic0.toLowerCase() ===
            TOPIC_LEND_POSITION_WITHDRAWN.toLowerCase()
        ) {
            try {
                const decoded = decodeEventLog({
                    abi: [LEND_POSITION_WITHDRAWN_EVENT],
                    data: log.data,
                    topics: log.topics,
                });
                const typed =
                    decoded.args as unknown as LendPositionWithdrawnArgs;
                if (typed.lender.toLowerCase() !== expectedUserLc) continue;
                withdrawnEvents.push({ logIndex: log.logIndex, args: typed });
            } catch {
                // ignore undecodable logs
            }
        } else if (topic0.toLowerCase() === TOPIC_CREDITED.toLowerCase()) {
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
                // ignore
            }
        }
    }

    return { withdrawnEvents, creditedEvents };
}

function logOutcome(
    txHash: Hex,
    eventName: "LendPositionWithdrawn" | "Credited",
    logIndex: number,
    result: ApplyOnChainEffectResult,
): void {
    if (result.applied) return;
    if (result.reason === "already_stamped") {
        logger.debug(
            `withdraw-lend ${eventName} already stamped ` +
                `(txHash=${txHash} logIndex=${logIndex})`,
        );
        return;
    }
    logger.warn(
        `withdraw-lend ${eventName} not applied ` +
            `(txHash=${txHash} logIndex=${logIndex} reason=${result.reason})`,
    );
}
