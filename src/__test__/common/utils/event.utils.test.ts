import { encodeEventTopics, encodeAbiParameters, type Abi } from "viem";
import {
    getEventLogsFromReceipt,
    getFirstEventFromReceipt,
} from "../../../common/utils/event.utils";

const TEST_ABI: Abi = [
    {
        type: "event",
        name: "LendPositionWithdrawn",
        inputs: [
            {
                name: "marketId",
                type: "bytes32",
                indexed: true,
                internalType: "bytes32",
            },
            {
                name: "lender",
                type: "address",
                indexed: true,
                internalType: "address",
            },
            {
                name: "cbtBurned",
                type: "uint256",
                indexed: false,
                internalType: "uint256",
            },
            {
                name: "amountWithdrawn",
                type: "uint256",
                indexed: false,
                internalType: "uint256",
            },
        ],
        anonymous: false,
    },
    {
        type: "event",
        name: "Deposited",
        inputs: [
            {
                name: "user",
                type: "address",
                indexed: true,
                internalType: "address",
            },
            {
                name: "amount",
                type: "uint256",
                indexed: false,
                internalType: "uint256",
            },
        ],
        anonymous: false,
    },
];

const CONTRACT_A = "0x1234567890AbcdEF1234567890aBcdef12345678";
const CONTRACT_B = "0xABcdEFABcdEFabcdEfAbCdefabcdeFABcDEFabCD";
const TX_HASH =
    "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
const BLOCK_NUMBER = 12345n;

function createMockReceipt(logs: any[] = []) {
    return {
        transactionHash: TX_HASH,
        blockNumber: BLOCK_NUMBER,
        status: "success" as const,
        logs,
    } as any;
}

function createWithdrawLog(
    cbtBurned: bigint,
    amountWithdrawn: bigint,
    address: string = CONTRACT_A,
    logIndex: number = 0,
) {
    const marketId =
        "0x0000000000000000000000000000000000000000000000000000000000000001";
    const lender = "0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF";

    const topics = encodeEventTopics({
        abi: TEST_ABI,
        eventName: "LendPositionWithdrawn",
        args: {
            marketId: marketId as `0x${string}`,
            lender: lender as `0x${string}`,
        },
    });

    const data = encodeAbiParameters(
        [
            { name: "cbtBurned", type: "uint256" },
            { name: "amountWithdrawn", type: "uint256" },
        ],
        [cbtBurned, amountWithdrawn],
    );

    return {
        address,
        topics,
        data,
        logIndex,
        blockNumber: BLOCK_NUMBER,
        transactionHash: TX_HASH,
        blockHash:
            "0x0000000000000000000000000000000000000000000000000000000000000000",
        transactionIndex: 0,
        removed: false,
    };
}

function createDepositLog(
    amount: bigint,
    user: string,
    address: string = CONTRACT_B,
    logIndex: number = 0,
) {
    const topics = encodeEventTopics({
        abi: TEST_ABI,
        eventName: "Deposited",
        args: { user: user as `0x${string}` },
    });

    const data = encodeAbiParameters(
        [{ name: "amount", type: "uint256" }],
        [amount],
    );

    return {
        address,
        topics,
        data,
        logIndex,
        blockNumber: BLOCK_NUMBER,
        transactionHash: TX_HASH,
        blockHash:
            "0x0000000000000000000000000000000000000000000000000000000000000000",
        transactionIndex: 0,
        removed: false,
    };
}

describe("getEventLogsFromReceipt", () => {
    it("should parse a single matching event", () => {
        const receipt = createMockReceipt([createWithdrawLog(1000n, 900n)]);

        const events = getEventLogsFromReceipt<{
            cbtBurned: bigint;
            amountWithdrawn: bigint;
        }>(receipt, TEST_ABI, "LendPositionWithdrawn");

        expect(events).toHaveLength(1);
        expect(events[0].eventName).toBe("LendPositionWithdrawn");
        expect(events[0].args.cbtBurned).toBe(1000n);
        expect(events[0].args.amountWithdrawn).toBe(900n);
        expect(events[0].transactionHash).toBe(TX_HASH);
        expect(events[0].blockNumber).toBe(BLOCK_NUMBER);
        expect(events[0].address).toBe(CONTRACT_A);
        expect(events[0].logIndex).toBe(0);
    });

    it("should return empty array when no matching events", () => {
        const receipt = createMockReceipt([
            createDepositLog(
                500n,
                "0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF",
            ),
        ]);

        const events = getEventLogsFromReceipt(
            receipt,
            TEST_ABI,
            "LendPositionWithdrawn",
        );

        expect(events).toHaveLength(0);
    });

    it("should return empty array for receipt with no logs", () => {
        const receipt = createMockReceipt([]);
        const events = getEventLogsFromReceipt(
            receipt,
            TEST_ABI,
            "LendPositionWithdrawn",
        );
        expect(events).toHaveLength(0);
    });

    it("should parse multiple events of the same type", () => {
        const receipt = createMockReceipt([
            createWithdrawLog(1000n, 900n, CONTRACT_A, 0),
            createWithdrawLog(2000n, 1800n, CONTRACT_A, 1),
            createWithdrawLog(500n, 450n, CONTRACT_A, 2),
        ]);

        const events = getEventLogsFromReceipt<{
            cbtBurned: bigint;
            amountWithdrawn: bigint;
        }>(receipt, TEST_ABI, "LendPositionWithdrawn");

        expect(events).toHaveLength(3);
        expect(events[0].args.cbtBurned).toBe(1000n);
        expect(events[1].args.cbtBurned).toBe(2000n);
        expect(events[2].args.cbtBurned).toBe(500n);
        expect(events[0].logIndex).toBe(0);
        expect(events[1].logIndex).toBe(1);
        expect(events[2].logIndex).toBe(2);
    });

    it("should filter by contract address (case-insensitive)", () => {
        const receipt = createMockReceipt([
            createWithdrawLog(1000n, 900n, CONTRACT_A, 0),
            createWithdrawLog(2000n, 1800n, CONTRACT_B, 1),
        ]);

        const eventsA = getEventLogsFromReceipt<{
            cbtBurned: bigint;
            amountWithdrawn: bigint;
        }>(
            receipt,
            TEST_ABI,
            "LendPositionWithdrawn",
            CONTRACT_A.toLowerCase(),
        );

        expect(eventsA).toHaveLength(1);
        expect(eventsA[0].args.cbtBurned).toBe(1000n);

        // uppercase filter should also match
        const eventsB = getEventLogsFromReceipt(
            receipt,
            TEST_ABI,
            "LendPositionWithdrawn",
            CONTRACT_B.toUpperCase(),
        );
        expect(eventsB).toHaveLength(1);
    });

    it("should return all events when no contract address filter", () => {
        const receipt = createMockReceipt([
            createWithdrawLog(1000n, 900n, CONTRACT_A, 0),
            createWithdrawLog(2000n, 1800n, CONTRACT_B, 1),
        ]);

        const events = getEventLogsFromReceipt(
            receipt,
            TEST_ABI,
            "LendPositionWithdrawn",
        );
        expect(events).toHaveLength(2);
    });

    it("should handle mixed event types and only return matching", () => {
        const receipt = createMockReceipt([
            createWithdrawLog(1000n, 900n, CONTRACT_A, 0),
            createDepositLog(
                500n,
                "0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF",
                CONTRACT_B,
                1,
            ),
            createWithdrawLog(2000n, 1800n, CONTRACT_A, 2),
        ]);

        const withdrawEvents = getEventLogsFromReceipt(
            receipt,
            TEST_ABI,
            "LendPositionWithdrawn",
        );
        expect(withdrawEvents).toHaveLength(2);

        const depositEvents = getEventLogsFromReceipt(
            receipt,
            TEST_ABI,
            "Deposited",
        );
        expect(depositEvents).toHaveLength(1);
    });

    it("should handle large BigInt values", () => {
        const largeCbt = 2n ** 128n - 1n;
        const largeAmount = 2n ** 256n - 1n;

        const receipt = createMockReceipt([
            createWithdrawLog(largeCbt, largeAmount),
        ]);

        const events = getEventLogsFromReceipt<{
            cbtBurned: bigint;
            amountWithdrawn: bigint;
        }>(receipt, TEST_ABI, "LendPositionWithdrawn");

        expect(events).toHaveLength(1);
        expect(events[0].args.cbtBurned).toBe(largeCbt);
        expect(events[0].args.amountWithdrawn).toBe(largeAmount);
    });

    it("should handle zero values", () => {
        const receipt = createMockReceipt([createWithdrawLog(0n, 0n)]);

        const events = getEventLogsFromReceipt<{
            cbtBurned: bigint;
            amountWithdrawn: bigint;
        }>(receipt, TEST_ABI, "LendPositionWithdrawn");

        expect(events).toHaveLength(1);
        expect(events[0].args.cbtBurned).toBe(0n);
        expect(events[0].args.amountWithdrawn).toBe(0n);
    });
});

describe("getFirstEventFromReceipt", () => {
    it("should return the first matching event", () => {
        const receipt = createMockReceipt([
            createWithdrawLog(1000n, 900n, CONTRACT_A, 0),
            createWithdrawLog(2000n, 1800n, CONTRACT_A, 1),
        ]);

        const event = getFirstEventFromReceipt<{
            cbtBurned: bigint;
            amountWithdrawn: bigint;
        }>(receipt, TEST_ABI, "LendPositionWithdrawn");

        expect(event.args.cbtBurned).toBe(1000n);
        expect(event.args.amountWithdrawn).toBe(900n);
    });

    it("should throw when no matching event found", () => {
        const receipt = createMockReceipt([]);

        expect(() =>
            getFirstEventFromReceipt(
                receipt,
                TEST_ABI,
                "LendPositionWithdrawn",
            ),
        ).toThrow(
            `No "LendPositionWithdrawn" event found in transaction ${TX_HASH}`,
        );
    });

    it("should throw when only non-matching events exist", () => {
        const receipt = createMockReceipt([
            createDepositLog(
                500n,
                "0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF",
            ),
        ]);

        expect(() =>
            getFirstEventFromReceipt(
                receipt,
                TEST_ABI,
                "LendPositionWithdrawn",
            ),
        ).toThrow(
            `No "LendPositionWithdrawn" event found in transaction ${TX_HASH}`,
        );
    });

    it("should throw when contract address filter excludes all", () => {
        const receipt = createMockReceipt([
            createWithdrawLog(1000n, 900n, CONTRACT_A, 0),
        ]);

        expect(() =>
            getFirstEventFromReceipt(
                receipt,
                TEST_ABI,
                "LendPositionWithdrawn",
                CONTRACT_B,
            ),
        ).toThrow(
            `No "LendPositionWithdrawn" event found in transaction ${TX_HASH}`,
        );
    });

    it("should include tx hash in error message", () => {
        const customTxHash =
            "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
        const receipt = createMockReceipt([]);
        receipt.transactionHash = customTxHash;

        expect(() =>
            getFirstEventFromReceipt(receipt, TEST_ABI, "SomeEvent"),
        ).toThrow(`No "SomeEvent" event found in transaction ${customTxHash}`);
    });

    it("should respect contract address filter", () => {
        const receipt = createMockReceipt([
            createWithdrawLog(1000n, 900n, CONTRACT_A, 0),
            createWithdrawLog(2000n, 1800n, CONTRACT_B, 1),
        ]);

        const event = getFirstEventFromReceipt<{
            cbtBurned: bigint;
            amountWithdrawn: bigint;
        }>(receipt, TEST_ABI, "LendPositionWithdrawn", CONTRACT_B);

        expect(event.args.cbtBurned).toBe(2000n);
    });
});
