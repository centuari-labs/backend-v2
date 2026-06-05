/**
 * Unit tests for `applyDepositEffects`. The helper loops over `Credited`
 * logs in a deposit receipt, dispatching one `applyOnChainEffect` call per
 * log scoped to its own `logIndex` — the SAME key indexer-v3's balance-ledger
 * processor stamps, so the eager path and the indexer tail no-op each other.
 * We assert:
 *  - one helper call per matching Credited log, keyed by logIndex;
 *  - logs for a different user are filtered out before the helper runs;
 *  - the returned count reflects only `{ applied: true }` results (an
 *    `already_stamped` credit is not double-counted).
 */

import {
    type Address,
    type Hex,
    type TransactionReceipt,
    keccak256,
    toHex,
} from "viem";
import { applyDepositEffects } from "../../../core/on-chain-state/apply-deposit";

import {
    applyOnChainEffect as applyOnChainEffectMock,
    type ApplyOnChainEffectArgs,
    type ApplyOnChainEffectResult,
} from "@centuari-labs/on-chain-effects";

jest.mock("@centuari-labs/on-chain-effects");

const applyOnChainEffectFn = applyOnChainEffectMock as jest.MockedFunction<
    <T>(args: ApplyOnChainEffectArgs<T>) => Promise<ApplyOnChainEffectResult>
>;

const TOPIC_CREDITED = keccak256(
    toHex("Credited(address,address,address,uint256,uint256)"),
);

const USER: Address = "0x1111111111111111111111111111111111111111";
const OTHER_USER: Address = "0x2222222222222222222222222222222222222222";
const WRITER: Address = "0x3333333333333333333333333333333333333333";
const ASSET: Address = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const LEDGER: Address = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const ROGUE_CONTRACT: Address = "0xcccccccccccccccccccccccccccccccccccccccc";

function padAddress(addr: Address): Hex {
    return `0x000000000000000000000000${addr.slice(2)}` as Hex;
}

function encodeUint256(n: bigint): Hex {
    return `0x${n.toString(16).padStart(64, "0")}` as Hex;
}

function makeCreditedLog(
    logIndex: number,
    user: Address,
    amount: bigint,
    emitter: Address = LEDGER,
): TransactionReceipt["logs"][number] {
    // data = amount (uint256) ++ newAvailable (uint256)
    const data = (encodeUint256(amount) + encodeUint256(0n).slice(2)) as Hex;
    return {
        address: emitter,
        blockHash: "0x" + "bb".repeat(32),
        blockNumber: 1n,
        data,
        logIndex,
        removed: false,
        topics: [
            TOPIC_CREDITED,
            padAddress(WRITER),
            padAddress(user),
            padAddress(ASSET),
        ],
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

describe("applyDepositEffects", () => {
    beforeEach(() => {
        applyOnChainEffectFn.mockReset();
        applyOnChainEffectFn.mockResolvedValue({ applied: true });
    });

    it("invokes applyOnChainEffect once per Credited log, keyed by logIndex", async () => {
        const receipt = makeReceipt([
            makeCreditedLog(0, USER, 100n),
            makeCreditedLog(1, USER, 50n),
        ]);

        const applied = await applyDepositEffects({
            pool: {} as never,
            client: {} as never,
            receipt,
            expectedUser: USER,
            balanceLedgerAddress: LEDGER,
        });

        expect(applyOnChainEffectFn).toHaveBeenCalledTimes(2);
        expect(applyOnChainEffectFn.mock.calls[0][0].logIndex).toBe(0);
        expect(applyOnChainEffectFn.mock.calls[1][0].logIndex).toBe(1);
        expect(applied).toBe(2);
    });

    it("skips Credited logs for a different user", async () => {
        const receipt = makeReceipt([
            makeCreditedLog(0, OTHER_USER, 10n),
            makeCreditedLog(1, USER, 10n),
        ]);

        const applied = await applyDepositEffects({
            pool: {} as never,
            client: {} as never,
            receipt,
            expectedUser: USER,
            balanceLedgerAddress: LEDGER,
        });

        expect(applyOnChainEffectFn).toHaveBeenCalledTimes(1);
        expect(applyOnChainEffectFn.mock.calls[0][0].logIndex).toBe(1);
        expect(applied).toBe(1);
    });

    it("rejects Credited logs not emitted by the canonical BalanceLedger", async () => {
        const receipt = makeReceipt([
            // Spoofed log from a rogue contract sharing the Credited topic shape.
            makeCreditedLog(0, USER, 999n, ROGUE_CONTRACT),
            // Genuine log from the real BalanceLedger.
            makeCreditedLog(1, USER, 10n, LEDGER),
        ]);

        const applied = await applyDepositEffects({
            pool: {} as never,
            client: {} as never,
            receipt,
            expectedUser: USER,
            balanceLedgerAddress: LEDGER,
        });

        expect(applyOnChainEffectFn).toHaveBeenCalledTimes(1);
        expect(applyOnChainEffectFn.mock.calls[0][0].logIndex).toBe(1);
        expect(applied).toBe(1);
    });

    it("tolerates an empty receipt", async () => {
        const applied = await applyDepositEffects({
            pool: {} as never,
            client: {} as never,
            receipt: makeReceipt([]),
            expectedUser: USER,
            balanceLedgerAddress: LEDGER,
        });

        expect(applyOnChainEffectFn).not.toHaveBeenCalled();
        expect(applied).toBe(0);
    });

    it("does not count an already_stamped credit (idempotent with the indexer tail)", async () => {
        applyOnChainEffectFn.mockResolvedValueOnce({
            applied: false,
            reason: "already_stamped",
        });

        const receipt = makeReceipt([makeCreditedLog(0, USER, 10n)]);

        const applied = await applyDepositEffects({
            pool: {} as never,
            client: {} as never,
            receipt,
            expectedUser: USER,
            balanceLedgerAddress: LEDGER,
        });

        expect(applyOnChainEffectFn).toHaveBeenCalledTimes(1);
        expect(applied).toBe(0);
    });
});
