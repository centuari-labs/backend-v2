import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { ViemService } from "../../../core/viem/viem.service";
import { createPublicClient, createWalletClient } from "viem";

// Mock viem functions
jest.mock("viem", () => ({
    ...jest.requireActual("viem"),
    createPublicClient: jest.fn(),
    createWalletClient: jest.fn(),
    http: jest.fn(),
}));

jest.mock("viem/accounts", () => ({
    ...jest.requireActual("viem/accounts"),
    privateKeyToAccount: jest.fn((_key) => ({ address: "0xMockAddress" })),
}));

describe("ViemService", () => {
    let service: ViemService;
    let configService: ConfigService;

    const mockConfigService = {
        get: jest.fn((key: string) => {
            if (key === "SUPPORTED_CHAINS") return "11155111, 8453"; // Sepolia, Base
            if (key === "RPC_11155111") return "https://mock-rpc.com";
            if (key === "RPC_8453") return "https://mock-base-rpc.com";
            return null;
        }),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ViemService,
                { provide: ConfigService, useValue: mockConfigService },
            ],
        }).compile();

        service = module.get<ViemService>(ViemService);
        configService = module.get<ConfigService>(ConfigService);

        jest.clearAllMocks();
    });

    it("should be defined", () => {
        expect(service).toBeDefined();
    });

    describe("onModuleInit", () => {
        it("should initialize supported chains from config", () => {
            service.onModuleInit();
            // We can't easily check private map, but we can check if getPublicClient works without error for these chains
            // mocking createPublicClient to return a dummy
            (createPublicClient as jest.Mock).mockReturnValue({
                readContract: jest.fn(),
            });

            const client = service.getPublicClient(11155111);
            expect(client).toBeDefined();
            expect(createPublicClient).toHaveBeenCalled();
        });

        it("should verify valid address", () => {
            expect(
                service.isValidAddress(
                    "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
                ),
            ).toBe(true);
            expect(service.isValidAddress("invalid-address")).toBe(false);
        });
    });

    describe("getPublicClient", () => {
        it("should throw error for unsupported chain", () => {
            service.onModuleInit();
            expect(() => service.getPublicClient(999999)).toThrow(
                "Unsupported or unconfigured chainId: 999999",
            );
        });

        it("should reuse existing client", () => {
            service.onModuleInit();
            (createPublicClient as jest.Mock).mockReturnValue({
                id: "mock-client",
            });

            const client1 = service.getPublicClient(11155111);
            const client2 = service.getPublicClient(11155111);

            expect(client1).toBe(client2);
            expect(createPublicClient).toHaveBeenCalledTimes(1);
        });
    });

    describe("getWalletClient", () => {
        it("should cache wallet client by chainId-address key", () => {
            service.onModuleInit();
            (createWalletClient as jest.Mock).mockReturnValue({
                account: { address: "0xMockAddress" },
            });

            const client1 = service.getWalletClient("0xprivatekey", 11155111);
            const client2 = service.getWalletClient("0xprivatekey", 11155111);

            expect(client1).toBe(client2);
            expect(createWalletClient).toHaveBeenCalledTimes(1);
        });

        it("should create new client after resetWalletClient", () => {
            service.onModuleInit();
            (createWalletClient as jest.Mock).mockReturnValue({
                account: { address: "0xMockAddress" },
            });

            service.getWalletClient("0xprivatekey", 11155111);
            service.resetWalletClient("0xprivatekey", 11155111);
            service.getWalletClient("0xprivatekey", 11155111);

            expect(createWalletClient).toHaveBeenCalledTimes(2);
        });
    });

    describe("readContract", () => {
        it("should call publicClient.readContract and return result", async () => {
            service.onModuleInit();
            const mockReadContract = jest.fn().mockResolvedValue(42n);
            (createPublicClient as jest.Mock).mockReturnValue({
                readContract: mockReadContract,
            });

            const result = await service.readContract(
                11155111,
                "0xContractAddr",
                [],
                "balanceOf",
                ["0xUser"],
            );

            expect(result).toBe(42n);
            expect(mockReadContract).toHaveBeenCalledWith({
                address: "0xContractAddr",
                abi: [],
                functionName: "balanceOf",
                args: ["0xUser"],
            });
        });

        it("should throw and log error when readContract fails", async () => {
            service.onModuleInit();
            const mockReadContract = jest
                .fn()
                .mockRejectedValue(new Error("RPC error"));
            (createPublicClient as jest.Mock).mockReturnValue({
                readContract: mockReadContract,
            });

            await expect(
                service.readContract(
                    11155111,
                    "0xContractAddr",
                    [],
                    "balanceOf",
                ),
            ).rejects.toThrow("RPC error");
        });
    });

    describe("getTransactionReceipt", () => {
        it("should return receipt from public client", async () => {
            service.onModuleInit();
            const mockReceipt = { status: "success", transactionHash: "0xabc" };
            (createPublicClient as jest.Mock).mockReturnValue({
                getTransactionReceipt: jest.fn().mockResolvedValue(mockReceipt),
            });

            const receipt = await service.getTransactionReceipt(
                11155111,
                "0xabc" as any,
            );

            expect(receipt).toEqual(mockReceipt);
        });

        it("should throw when getTransactionReceipt fails", async () => {
            service.onModuleInit();
            (createPublicClient as jest.Mock).mockReturnValue({
                getTransactionReceipt: jest
                    .fn()
                    .mockRejectedValue(new Error("Not found")),
            });

            await expect(
                service.getTransactionReceipt(11155111, "0xbad" as any),
            ).rejects.toThrow("Not found");
        });
    });

    describe("generateWallet", () => {
        it("should return address and privateKey", () => {
            const wallet = service.generateWallet();

            expect(wallet).toHaveProperty("address");
            expect(wallet).toHaveProperty("privateKey");
        });
    });

    describe("writeContract queue", () => {
        it("should serialize writes for same address", async () => {
            service.onModuleInit();
            const callOrder: number[] = [];
            const mockGetTransactionCount = jest.fn().mockResolvedValue(0);
            const mockGetBlock = jest.fn().mockResolvedValue({
                baseFeePerGas: 1000n,
            });
            (createPublicClient as jest.Mock).mockReturnValue({
                getTransactionCount: mockGetTransactionCount,
                getBlock: mockGetBlock,
            });
            (createWalletClient as jest.Mock).mockReturnValue({
                account: { address: "0xMockAddress" },
                writeContract: jest
                    .fn()
                    .mockImplementationOnce(async () => {
                        callOrder.push(1);
                        return "0xhash1";
                    })
                    .mockImplementationOnce(async () => {
                        callOrder.push(2);
                        return "0xhash2";
                    }),
            });

            const p1 = service.writeContract(
                11155111,
                "0xprivatekey",
                "0xContract",
                [],
                "fn1",
            );
            const p2 = service.writeContract(
                11155111,
                "0xprivatekey",
                "0xContract",
                [],
                "fn2",
            );

            await Promise.all([p1, p2]);

            expect(callOrder).toEqual([1, 2]);
        });
    });
});
