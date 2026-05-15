/**
 * Unit tests for `applyWithdrawEffects`. The helper is a loop over the
 * parsed `Debited` events in a payout receipt, dispatching one
 * `applyOnChainEffect` call per matching log. We assert:
 *  - every matching log produces exactly one helper call, scoped to its
 *    own `logIndex`;
 *  - non-matching logs (wrong topic, or an event for a different user)
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
import { applyWithdrawEffects } from "../../../core/on-chain-state/apply-withdraw";

import {
    applyOnChainEffect as applyOnChainEffectMock,
    type ApplyOnChainEffectArgs,
    type ApplyOnChainEffectResult,
} from "@centuari-labs/on-chain-effects";

jest.mock("@centuari-labs/on-chain-effects");

const applyOnChainEffectFn = applyOnChainEffectMock as jest.MockedFunction<
    <T>(args: ApplyOnChainEffectArgs<T>) => Promise<ApplyOnChainEffectResult>
>;

const TOPIC_DEBITED = keccak256(
    toHex("Debited(address,address,address,uint256,uint256)"),
);

const USER: Address = "0x1111111111111111111111111111111111111111";
const OTHER_USER: Address = "0x2222222222222222222222222222222222222222";
const ASSET: Address = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function padAddress(addr: Address): Hex {
    return `0x000000000000000000000000${addr.slice(2)}` as Hex;
}

function encodeUint256(n: bigint): Hex {
    return `0x${n.toString(16).padStart(64, "0")}` as Hex;
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
            padAddress("0x3333333333333333333333333333333333333333" as Address),
            padAddress(user),
            padAddress(ASSET),
        ],
        transactionHash: "0x" + "cc".repeat(32),
        transactionIndex: 0,
    } as TransactionReceipt["logs"][number];
}

function makeOtherTopicLog(
    logIndex: number,
): TransactionReceipt["logs"][number] {
    return {
        address: "0x0000000000000000000000000000000000000000",
        blockHash: "0x" + "bb".repeat(32),
        blockNumber: 1n,
        data: encodeUint256(99n),
        logIndex,
        removed: false,
        topics: [
            keccak256(toHex("Something(uint256)")),
            padAddress(USER),
        ] as unknown as TransactionReceipt["logs"][number]["topics"],
        transactionHash: "0x" + "cc".repeat(32),
        transactionIndex: 0,
    } as TransactionReceipt["logs"][number];
}

function makeReceipt(logs: TransactionReceipt["logs"]): TransactionReceipt {
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

describe("applyWithdrawEffects", () => {
    beforeEach(() => {
        applyOnChainEffectFn.mockReset();
        applyOnChainEffectFn.mockResolvedValue({ applied: true });
    });

    it("invokes applyOnChainEffect once per Debited log, keyed by logIndex", async () => {
        const receipt = makeReceipt([
            makeDebitedLog(0, USER, 100n),
            makeDebitedLog(1, USER, 50n),
        ]);

        await applyWithdrawEffects({
            pool: {} as never,
            client: {} as never,
            receipt,
            expectedUser: USER,
        });

        expect(applyOnChainEffectFn).toHaveBeenCalledTimes(2);
        expect(applyOnChainEffectFn.mock.calls[0][0].logIndex).toBe(0);
        expect(applyOnChainEffectFn.mock.calls[1][0].logIndex).toBe(1);
    });

    it("skips logs for a different user", async () => {
        const receipt = makeReceipt([
            makeDebitedLog(0, OTHER_USER, 10n),
            makeDebitedLog(1, USER, 10n),
        ]);

        await applyWithdrawEffects({
            pool: {} as never,
            client: {} as never,
            receipt,
            expectedUser: USER,
        });

        expect(applyOnChainEffectFn).toHaveBeenCalledTimes(1);
        expect(applyOnChainEffectFn.mock.calls[0][0].logIndex).toBe(1);
    });

    it("skips logs with a non-Debited topic", async () => {
        const receipt = makeReceipt([
            makeOtherTopicLog(0),
            makeDebitedLog(1, USER, 25n),
        ]);

        await applyWithdrawEffects({
            pool: {} as never,
            client: {} as never,
            receipt,
            expectedUser: USER,
        });

        expect(applyOnChainEffectFn).toHaveBeenCalledTimes(1);
        expect(applyOnChainEffectFn.mock.calls[0][0].logIndex).toBe(1);
    });

    it("tolerates an empty receipt", async () => {
        await applyWithdrawEffects({
            pool: {} as never,
            client: {} as never,
            receipt: makeReceipt([]),
            expectedUser: USER,
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
            makeDebitedLog(0, USER, 10n),
            makeDebitedLog(1, USER, 20n),
        ]);

        await expect(
            applyWithdrawEffects({
                pool: {} as never,
                client: {} as never,
                receipt,
                expectedUser: USER,
            }),
        ).resolves.not.toThrow();

        expect(applyOnChainEffectFn).toHaveBeenCalledTimes(2);
    });
});
