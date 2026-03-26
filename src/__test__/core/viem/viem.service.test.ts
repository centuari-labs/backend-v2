jest.mock("viem", () => ({
    isAddress: jest.fn(),
    createPublicClient: jest.fn(),
    http: jest.fn(),
}));

jest.mock("viem/accounts", () => ({
    generatePrivateKey: jest.fn(),
    privateKeyToAccount: jest.fn(),
}));

jest.mock("viem/chains", () => ({
    base: { id: 8453, name: "Base" },
}));

import { createPublicClient, http, isAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ViemService } from "../../../core/viem/viem.service";

const mockIsAddress = isAddress as jest.Mock;
const mockCreatePublicClient = createPublicClient as jest.Mock;
const mockHttp = http as jest.Mock;
const mockGeneratePrivateKey = generatePrivateKey as jest.Mock;
const mockPrivateKeyToAccount = privateKeyToAccount as jest.Mock;

describe("ViemService", () => {
    let service: ViemService;

    beforeEach(() => {
        jest.clearAllMocks();
        service = new ViemService();
    });

    describe("isValidAddress", () => {
        it("should return true for valid Ethereum address", () => {
            mockIsAddress.mockReturnValue(true);

            expect(
                service.isValidAddress(
                    "0x1234567890abcdef1234567890abcdef12345678",
                ),
            ).toBe(true);
            expect(mockIsAddress).toHaveBeenCalledWith(
                "0x1234567890abcdef1234567890abcdef12345678",
            );
        });

        it("should return false for invalid address", () => {
            mockIsAddress.mockReturnValue(false);

            expect(service.isValidAddress("not-an-address")).toBe(false);
        });

        it("should return false for empty string", () => {
            mockIsAddress.mockReturnValue(false);

            expect(service.isValidAddress("")).toBe(false);
        });
    });

    describe("getClient", () => {
        it("should create a new client for unknown chainId", () => {
            const mockClient = { getBlockNumber: jest.fn() };
            mockCreatePublicClient.mockReturnValue(mockClient);
            mockHttp.mockReturnValue("http-transport");

            const result = service.getClient(8453);

            expect(mockCreatePublicClient).toHaveBeenCalled();
            expect(result).toBe(mockClient);
        });

        it("should return cached client for same chainId", () => {
            const mockClient = { getBlockNumber: jest.fn() };
            mockCreatePublicClient.mockReturnValue(mockClient);

            const first = service.getClient(8453);
            const second = service.getClient(8453);

            expect(first).toBe(second);
            expect(mockCreatePublicClient).toHaveBeenCalledTimes(1);
        });

        it("should create separate clients for different chainIds", () => {
            mockCreatePublicClient
                .mockReturnValueOnce({ id: "client-1" })
                .mockReturnValueOnce({ id: "client-2" });

            const client1 = service.getClient(8453);
            const client2 = service.getClient(1);

            expect(client1).not.toBe(client2);
            expect(mockCreatePublicClient).toHaveBeenCalledTimes(2);
        });
    });

    describe("generateWallet", () => {
        it("should return address and privateKey", () => {
            const mockPk = "0xabc123";
            const mockAccount = { address: "0xGenerated123" };
            mockGeneratePrivateKey.mockReturnValue(mockPk);
            mockPrivateKeyToAccount.mockReturnValue(mockAccount);

            const result = service.generateWallet();

            expect(result).toEqual({
                address: "0xGenerated123",
                privateKey: mockPk,
            });
            expect(mockGeneratePrivateKey).toHaveBeenCalled();
            expect(mockPrivateKeyToAccount).toHaveBeenCalledWith(mockPk);
        });
    });
});
