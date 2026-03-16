import {
    parseEventLogs,
    type Abi,
    type Log,
    type TransactionReceipt,
} from "viem";

export interface ParsedEventLog<TArgs = Record<string, unknown>> {
    eventName: string;
    args: TArgs;
    address: string;
    logIndex: number;
    transactionHash: string;
    blockNumber: bigint;
}

/**
 * Parse event logs from a transaction receipt by ABI and event name.
 *
 * @param receipt - The full transaction receipt from viem
 * @param abi - The contract ABI containing the event definition
 * @param eventName - The name of the event to extract
 * @param contractAddress - Optional: filter logs by contract address
 * @returns Array of parsed event logs with typed args
 *
 * @example
 * ```ts
 * const events = getEventLogsFromReceipt<{
 *     cbtBurned: bigint;
 *     amountWithdrawn: bigint;
 * }>(receipt, centuariAbi, "LendPositionWithdrawn");
 * ```
 */
export function getEventLogsFromReceipt<
    TArgs = Record<string, unknown>,
>(
    receipt: TransactionReceipt,
    abi: Abi,
    eventName: string,
    contractAddress?: string,
): ParsedEventLog<TArgs>[] {
    let logs = parseEventLogs({
        abi,
        eventName,
        logs: receipt.logs as Log[],
    });

    if (contractAddress) {
        const normalizedAddress = contractAddress.toLowerCase();
        logs = logs.filter(
            (log) =>
                log.address?.toLowerCase() ===
                normalizedAddress,
        );
    }

    return logs.map((log) => ({
        eventName,
        args: log.args as TArgs,
        address: log.address,
        logIndex: log.logIndex ?? 0,
        transactionHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber,
    }));
}

/**
 * Parse a single event from a transaction receipt.
 * Throws if the event is not found.
 *
 * @throws Error if no matching event is found
 *
 * @example
 * ```ts
 * const event = getFirstEventFromReceipt<{
 *     cbtBurned: bigint;
 *     amountWithdrawn: bigint;
 * }>(receipt, centuariAbi, "LendPositionWithdrawn");
 *
 * console.log(event.args.cbtBurned);
 * ```
 */
export function getFirstEventFromReceipt<
    TArgs = Record<string, unknown>,
>(
    receipt: TransactionReceipt,
    abi: Abi,
    eventName: string,
    contractAddress?: string,
): ParsedEventLog<TArgs> {
    const events = getEventLogsFromReceipt<TArgs>(
        receipt,
        abi,
        eventName,
        contractAddress,
    );

    if (events.length === 0) {
        throw new Error(
            `No "${eventName}" event found in transaction ${receipt.transactionHash}`,
        );
    }

    return events[0];
}
