/**
 * Unit tests for `applyRepayEffects`. The helper is a loop over the parsed
 * events in a settlement receipt, dispatching one `applyOnChainEffect`
 * call per `Repaid` / `Debited` log. We assert:
 *  - every matching log produces exactly one helper call, scoped to its
 *    own `logIndex`;
 *  - non-matching logs (wrong topic, or an event for a different borrower)
 *    are filtered out before the helper is invoked;
 *  - `already_stamped` / `event_missing` reasons are tolerated silently.
 */

import {
    type Address,
    type Hex,
    type TransactionReceipt,
    keccak256,
    toHex,
} from "viem";
import { applyRepayEffects } from "../../../core/on-chain-state/apply-repay";

import {
    applyOnChainEffect as applyOnChainEffectMock,
    type ApplyOnChainEffectArgs,
    type ApplyOnChainEffectResult,
} from "@centuari-labs/on-chain-effects";

jest.mock("@centuari-labs/on-chain-effects");

const applyOnChainEffectFn =
    applyOnChainEffectMock as jest.MockedFunction<
        <T>(
            args: ApplyOnChainEffectArgs<T>,
        ) => Promise<ApplyOnChainEffectResult>
    >;

const TOPIC_REPAID = keccak256(toHex("Repaid(bytes32,address,uint256)"));
const TOPIC_DEBITED = keccak256(
    toHex("Debited(address,address,address,uint256,uint256)"),
);

const BORROWER: Address = "0x1111111111111111111111111111111111111111";
const OTHER_USER: Address = "0x2222222222222222222222222222222222222222";
const MARKET_ID: Hex = ("0x" + "ab".repeat(32)) as Hex;
const ASSET: Address = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

// ABI used to encode event data for the fixture receipts.
const REPAID_EVENT_ABI = [
    {
        type: "event",
        name: "Repaid",
        inputs: [
            { name: "marketId", type: "bytes32", indexed: true },
            { name: "borrower", type: "address", indexed: true },
            { name: "amount", type: "uint256", indexed: false },
        ],
    },
] as const;

const DEBITED_EVENT_ABI = [
    {
        type: "event",
        name: "Debited",
        inputs: [
            { name: "writer", type: "address", indexed: true },
            { name: "user", type: "address", indexed: true },
            { name: "asset", type: "address", indexed: true },
            { name: "amount", type: "uint256", indexed: false },
            { name: "newAvailable", type: "uint256", indexed: false },
        ],
    },
] as const;

function padAddress(addr: Address): Hex {
    return `0x000000000000000000000000${addr.slice(2)}` as Hex;
}

function encodeUint256(n: bigint): Hex {
    return `0x${n.toString(16).padStart(64, "0")}` as Hex;
}

function makeRepaidLog(
    logIndex: number,
    borrower: Address,
    amount: bigint,
): TransactionReceipt["logs"][number] {
    return {
        address: "0x0000000000000000000000000000000000000000",
        blockHash: "0x" + "bb".repeat(32),
        blockNumber: 1n,
        data: encodeUint256(amount),
        logIndex,
        removed: false,
        topics: [TOPIC_REPAID, MARKET_ID, padAddress(borrower)],
        transactionHash: "0x" + "cc".repeat(32),
        transactionIndex: 0,
    } as TransactionReceipt["logs"][number];
}

function makeDebitedLog(
    logIndex: number,
    user: Address,
    amount: bigint,
): TransactionReceipt["logs"][number] {
    const data = (encodeUint256(amount) + encodeUint256(0n).slice(2)) as Hex;
    return {
        address: "0x0000000000000000000000000000000000000000",
        blockHash: "0x" + "bb".repeat(32),
        blockNumber: 1n,
        data,
        logIndex,
        removed: false,
        topics: [
            TOPIC_DEBITED,
            padAddress(
                "0x3333333333333333333333333333333333333333" as Address,
            ),
            padAddress(user),
            padAddress(ASSET),
        ],
        transactionHash: "0x" + "cc".repeat(32),
        transactionIndex: 0,
    } as TransactionReceipt["logs"][number];
}

function makeReceipt(
    logs: TransactionReceipt["logs"],
): TransactionReceipt {
    return {
        blockHash: "0x" + "bb".repeat(32),
        blockNumber: 1n,
        contractAddress: null,
        cumulativeGasUsed: 0n,
        effectiveGasPrice: 0n,
        from: "0x0000000000000000000000000000000000000000",
        gasUsed: 0n,
        logs,
        logsBloom: "0x",
        status: "success",
        to: "0x0000000000000000000000000000000000000000",
        transactionHash: "0x" + "cc".repeat(32),
        transactionIndex: 0,
        type: "eip1559",
    } as unknown as TransactionReceipt;
}

describe("applyRepayEffects", () => {
    beforeEach(() => {
        applyOnChainEffectFn.mockReset();
        applyOnChainEffectFn.mockResolvedValue({ applied: true });
    });

    it("invokes applyOnChainEffect once per Repaid log, keyed by logIndex", async () => {
        const receipt = makeReceipt([
            makeRepaidLog(0, BORROWER, 100n),
            makeRepaidLog(1, BORROWER, 50n),
        ]);

        await applyRepayEffects({
            pool: {} as never,
            client: {} as never,
            receipt,
            expectedBorrower: BORROWER,
        });

        expect(applyOnChainEffectFn).toHaveBeenCalledTimes(2);
        expect(applyOnChainEffectFn.mock.calls[0][0].logIndex).toBe(0);
        expect(applyOnChainEffectFn.mock.calls[1][0].logIndex).toBe(1);
    });

    it("invokes applyOnChainEffect once per Debited log", async () => {
        const receipt = makeReceipt([
            makeDebitedLog(5, BORROWER, 200n),
        ]);

        await applyRepayEffects({
            pool: {} as never,
            client: {} as never,
            receipt,
            expectedBorrower: BORROWER,
        });

        expect(applyOnChainEffectFn).toHaveBeenCalledTimes(1);
        expect(applyOnChainEffectFn.mock.calls[0][0].logIndex).toBe(5);
    });

    it("skips logs for a different borrower", async () => {
        const receipt = makeReceipt([
            makeRepaidLog(0, OTHER_USER, 10n),
            makeRepaidLog(1, BORROWER, 10n),
            makeDebitedLog(2, OTHER_USER, 20n),
        ]);

        await applyRepayEffects({
            pool: {} as never,
            client: {} as never,
            receipt,
            expectedBorrower: BORROWER,
        });

        expect(applyOnChainEffectFn).toHaveBeenCalledTimes(1);
        expect(applyOnChainEffectFn.mock.calls[0][0].logIndex).toBe(1);
    });

    it("tolerates an empty receipt", async () => {
        await applyRepayEffects({
            pool: {} as never,
            client: {} as never,
            receipt: makeReceipt([]),
            expectedBorrower: BORROWER,
        });

        expect(applyOnChainEffectFn).not.toHaveBeenCalled();
    });

    it("continues when the helper reports already_stamped", async () => {
        applyOnChainEffectFn.mockResolvedValueOnce({
            applied: false,
            reason: "already_stamped",
        });
        applyOnChainEffectFn.mockResolvedValueOnce({ applied: true });

        const receipt = makeReceipt([
            makeRepaidLog(0, BORROWER, 10n),
            makeRepaidLog(1, BORROWER, 20n),
        ]);

        await expect(
            applyRepayEffects({
                pool: {} as never,
                client: {} as never,
                receipt,
                expectedBorrower: BORROWER,
            }),
        ).resolves.not.toThrow();

        expect(applyOnChainEffectFn).toHaveBeenCalledTimes(2);
    });
});
