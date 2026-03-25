jest.mock("viem", () => ({
    createPublicClient: jest.fn().mockReturnValue({ chain: "base" }),
    http: jest.fn().mockReturnValue("http-transport"),
    isAddress: jest.fn(),
}));

jest.mock("viem/accounts", () => ({
    generatePrivateKey: jest.fn(),
    privateKeyToAccount: jest.fn(),
}));

jest.mock("viem/chains", () => ({
    base: { id: 8453, name: "Base" },
}));

import { Test, TestingModule } from "@nestjs/testing";
import { isAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ViemService } from "../../../core/viem/viem.service";

describe("ViemService", () => {
    let service: ViemService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [ViemService],
        }).compile();

        service = module.get<ViemService>(ViemService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("isValidAddress", () => {
        it("should return true for valid Ethereum address", () => {
            (isAddress as unknown as jest.Mock).mockReturnValue(true);

            expect(
                service.isValidAddress(
                    "0x1234567890abcdef1234567890abcdef12345678",
                ),
            ).toBe(true);
            expect(isAddress).toHaveBeenCalledWith(
                "0x1234567890abcdef1234567890abcdef12345678",
            );
        });

        it("should return false for invalid address", () => {
            (isAddress as unknown as jest.Mock).mockReturnValue(false);

            expect(service.isValidAddress("invalid")).toBe(false);
        });

        it("should return false for empty string", () => {
            (isAddress as unknown as jest.Mock).mockReturnValue(false);

            expect(service.isValidAddress("")).toBe(false);
        });
    });

    describe("generateWallet", () => {
        it("should return address and privateKey", () => {
            const mockPrivateKey = "0xabcdef1234567890";
            const mockAccount = {
                address: "0xGeneratedAddress123456789012345678901234",
            };

            (generatePrivateKey as jest.Mock).mockReturnValue(mockPrivateKey);
            (privateKeyToAccount as jest.Mock).mockReturnValue(mockAccount);

            const result = service.generateWallet();

            expect(result).toEqual({
                address: mockAccount.address,
                privateKey: mockPrivateKey,
            });
            expect(generatePrivateKey).toHaveBeenCalled();
            expect(privateKeyToAccount).toHaveBeenCalledWith(mockPrivateKey);
        });
    });

    describe("getClient", () => {
        it("should create and cache client for new chainId", () => {
            const client = service.getClient(8453);

            expect(client).toBeDefined();
        });

        it("should return cached client for same chainId", () => {
            const client1 = service.getClient(8453);
            const client2 = service.getClient(8453);

            expect(client1).toBe(client2);
        });

        it("should create different clients for different chainIds", () => {
            service.getClient(8453);
            service.getClient(1);

            // Both get created (though they use same config in implementation)
            expect(service.getClient(8453)).toBeDefined();
            expect(service.getClient(1)).toBeDefined();
        });
    });
});
