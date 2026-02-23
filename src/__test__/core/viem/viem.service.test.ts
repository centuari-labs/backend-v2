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
    privateKeyToAccount: jest.fn((key) => ({ address: "0xMockAddress" })),
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
            expect(service.isValidAddress("0x742d35Cc6634C0532925a3b844Bc454e4438f44e")).toBe(true);
            expect(service.isValidAddress("invalid-address")).toBe(false);
        });
    });

    describe("getPublicClient", () => {
        it("should throw error for unsupported chain", () => {
            service.onModuleInit();
            expect(() => service.getPublicClient(999999)).toThrow("Unsupported or unconfigured chainId: 999999");
        });

        it("should reuse existing client", () => {
            service.onModuleInit();
            (createPublicClient as jest.Mock).mockReturnValue({ id: "mock-client" });

            const client1 = service.getPublicClient(11155111);
            const client2 = service.getPublicClient(11155111);

            expect(client1).toBe(client2);
            expect(createPublicClient).toHaveBeenCalledTimes(1);
        });
    });
});
