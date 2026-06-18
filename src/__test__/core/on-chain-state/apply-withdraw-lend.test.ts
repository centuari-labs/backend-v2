/**
 * Mirror of apply-repay.test.ts for the withdraw-lend eager path.
 * Asserts the helper dispatches one `applyOnChainEffect` call per
 * matching `LendPositionWithdrawn` / `Credited` log and filters by the
 * expected lender.
 */

import {
    type Address,
    type Hex,
    type TransactionReceipt,
    keccak256,
    toHex,
} from "viem";
import { applyWithdrawLendEffects } from "../../../core/on-chain-state/apply-withdraw-lend";

import {
    applyOnChainEffect as applyOnChainEffectMock,
    type ApplyOnChainEffectArgs,
    type ApplyOnChainEffectResult,
} from "@centuari-labs/on-chain-effects";

jest.mock("@centuari-labs/on-chain-effects");

const applyOnChainEffectFn = applyOnChainEffectMock as jest.MockedFunction<
    <T>(args: ApplyOnChainEffectArgs<T>) => Promise<ApplyOnChainEffectResult>
>;

const TOPIC_WITHDRAWN = keccak256(
    toHex("LendPositionWithdrawn(bytes32,address,uint256,uint256)"),
);
const TOPIC_CREDITED = keccak256(
    toHex("Credited(address,address,address,uint256,uint256)"),
);

const LENDER: Address = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER_USER: Address = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const MARKET_ID: Hex = ("0x" + "cd".repeat(32)) as Hex;
const ASSET: Address = "0xdddddddddddddddddddddddddddddddddddddddd";

function padAddress(addr: Address): Hex {
    return `0x000000000000000000000000${addr.slice(2)}` as Hex;
}

function encodeUint256(n: bigint): Hex {
    return `0x${n.toString(16).padStart(64, "0")}` as Hex;
}

function makeWithdrawnLog(
    logIndex: number,
    lender: Address,
    cbtBurned: bigint,
    amountWithdrawn: bigint,
): TransactionReceipt["logs"][number] {
    const data = (encodeUint256(cbtBurned) +
        encodeUint256(amountWithdrawn).slice(2)) as Hex;
    return {
        address: "0x0000000000000000000000000000000000000000",
        blockHash: "0x" + "ee".repeat(32),
        blockNumber: 1n,
        data,
        logIndex,
        removed: false,
        topics: [TOPIC_WITHDRAWN, MARKET_ID, padAddress(lender)],
        transactionHash: "0x" + "ff".repeat(32),
        transactionIndex: 0,
    } as TransactionReceipt["logs"][number];
}

function makeCreditedLog(
    logIndex: number,
    user: Address,
    amount: bigint,
): TransactionReceipt["logs"][number] {
    const data = (encodeUint256(amount) + encodeUint256(0n).slice(2)) as Hex;
    return {
        address: "0x0000000000000000000000000000000000000000",
        blockHash: "0x" + "ee".repeat(32),
        blockNumber: 1n,
        data,
        logIndex,
        removed: false,
        topics: [
            TOPIC_CREDITED,
            padAddress("0x9999999999999999999999999999999999999999" as Address),
            padAddress(user),
            padAddress(ASSET),
        ],
        transactionHash: "0x" + "ff".repeat(32),
        transactionIndex: 0,
    } as TransactionReceipt["logs"][number];
}

function makeReceipt(logs: TransactionReceipt["logs"]): TransactionReceipt {
    return {
        blockHash: "0x" + "ee".repeat(32),
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
        transactionHash: "0x" + "ff".repeat(32),
        transactionIndex: 0,
        type: "eip1559",
    } as unknown as TransactionReceipt;
}

describe("applyWithdrawLendEffects", () => {
    beforeEach(() => {
        applyOnChainEffectFn.mockReset();
        applyOnChainEffectFn.mockResolvedValue({ applied: true });
    });

    it("dispatches one helper call per LendPositionWithdrawn log, keyed by logIndex", async () => {
        const receipt = makeReceipt([
            makeWithdrawnLog(0, LENDER, 100n, 110n),
            makeWithdrawnLog(1, LENDER, 50n, 55n),
        ]);

        await applyWithdrawLendEffects({
            pool: {} as never,
            client: {} as never,
            receipt,
            expectedLender: LENDER,
        });

        expect(applyOnChainEffectFn).toHaveBeenCalledTimes(2);
        expect(applyOnChainEffectFn.mock.calls[0][0].logIndex).toBe(0);
        expect(applyOnChainEffectFn.mock.calls[1][0].logIndex).toBe(1);
    });

    it("dispatches one helper call per Credited log", async () => {
        const receipt = makeReceipt([makeCreditedLog(3, LENDER, 200n)]);

        await applyWithdrawLendEffects({
            pool: {} as never,
            client: {} as never,
            receipt,
            expectedLender: LENDER,
        });

        expect(applyOnChainEffectFn).toHaveBeenCalledTimes(1);
        expect(applyOnChainEffectFn.mock.calls[0][0].logIndex).toBe(3);
    });

    it("filters out logs for other users", async () => {
        const receipt = makeReceipt([
            makeWithdrawnLog(0, OTHER_USER, 1n, 2n),
            makeWithdrawnLog(1, LENDER, 1n, 2n),
            makeCreditedLog(2, OTHER_USER, 3n),
        ]);

        await applyWithdrawLendEffects({
            pool: {} as never,
            client: {} as never,
            receipt,
            expectedLender: LENDER,
        });

        expect(applyOnChainEffectFn).toHaveBeenCalledTimes(1);
        expect(applyOnChainEffectFn.mock.calls[0][0].logIndex).toBe(1);
    });

    it("tolerates already_stamped replies", async () => {
        applyOnChainEffectFn.mockResolvedValueOnce({
            applied: false,
            reason: "already_stamped",
        });
        applyOnChainEffectFn.mockResolvedValueOnce({ applied: true });

        await expect(
            applyWithdrawLendEffects({
                pool: {} as never,
                client: {} as never,
                receipt: makeReceipt([
                    makeWithdrawnLog(0, LENDER, 1n, 2n),
                    makeWithdrawnLog(1, LENDER, 3n, 4n),
                ]),
                expectedLender: LENDER,
            }),
        ).resolves.not.toThrow();

        expect(applyOnChainEffectFn).toHaveBeenCalledTimes(2);
    });
});
