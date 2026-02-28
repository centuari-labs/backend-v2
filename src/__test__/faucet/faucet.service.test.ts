import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { FaucetService } from "../../faucet/faucet.service";
import { ViemService } from "../../core/viem/viem.service";

describe("FaucetService", () => {
    let service: FaucetService;
    let viemService: jest.Mocked<ViemService>;
    let configService: jest.Mocked<ConfigService>;
    let loggerErrorSpy: jest.SpyInstance;
    let loggerLogSpy: jest.SpyInstance;

    beforeAll(() => {
        loggerErrorSpy = jest.spyOn(Logger.prototype, "error").mockImplementation(() => { });
        loggerLogSpy = jest.spyOn(Logger.prototype, "log").mockImplementation(() => { });
    });

    afterAll(() => {
        loggerErrorSpy.mockRestore();
        loggerLogSpy.mockRestore();
    });

    const CHAIN_ID = 42161;
    const TOKEN_ADDRESS_A = "0xTokenAddressAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const TOKEN_ADDRESS_B = "0xTokenAddressBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
    const RECIPIENT_ADDRESS = "0xRecipientAddress1234567890abcdef12345678";
    const OPERATOR_KEY = "0xOperatorPrivateKey";
    const FAUCET_ADDRESS = "0xFaucetContractAddress1234567890abcdef1234";
    const MAX_PER_REQUEST = BigInt("1000000000000000000");
    const TOKENS_ENV = `${TOKEN_ADDRESS_A},${TOKEN_ADDRESS_B}`;

    const makeTxReceipt = (hash: string) => ({
        transactionHash: hash,
        status: "success",
        blockNumber: BigInt(100),
    });

    beforeEach(async () => {
        const mockViemService: Partial<jest.Mocked<ViemService>> = {
            readContract: jest.fn(),
            writeContract: jest.fn(),
        };

        const mockConfigService: Partial<jest.Mocked<ConfigService>> = {
            get: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                FaucetService,
                { provide: ViemService, useValue: mockViemService },
                { provide: ConfigService, useValue: mockConfigService },
            ],
        }).compile();

        service = module.get(FaucetService);
        viemService = module.get(ViemService);
        configService = module.get(ConfigService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    function setupConfig(overrides: Record<string, string | undefined> = {}) {
        configService.get.mockImplementation((key: string) => {
            const defaults: Record<string, string> = {
                "OPERATOR_PRIVATE_KEY": OPERATOR_KEY,
                [`FAUCET_ADDRESS_${CHAIN_ID}`]: FAUCET_ADDRESS,
                [`FAUCET_TOKENS_${CHAIN_ID}`]: TOKENS_ENV,
            };
            if (key in overrides) return overrides[key];
            return defaults[key];
        });
    }

    describe("requestTokens", () => {
        it("should mint all configured tokens for recipient", async () => {
            setupConfig();
            viemService.readContract.mockResolvedValue([true, MAX_PER_REQUEST, BigInt(3600)]);
            viemService.writeContract
                .mockResolvedValueOnce(makeTxReceipt("0xaaa") as any)
                .mockResolvedValueOnce(makeTxReceipt("0xbbb") as any);

            const result = await service.requestTokens(CHAIN_ID, RECIPIENT_ADDRESS, "all-assets");

            expect(result.chainId).toBe(CHAIN_ID);
            expect(result.recipientAddress).toBe(RECIPIENT_ADDRESS);
            expect(result.status).toBe("success");
            expect(result.transactionHash).toBe("0xaaa");
            expect(result.blockNumber).toBe("100");
            expect(result.results).toHaveLength(2);

            expect(result.results[0]).toMatchObject({
                tokenAddress: TOKEN_ADDRESS_A,
                amount: MAX_PER_REQUEST.toString(),
            });
            expect(result.results[1]).toMatchObject({
                tokenAddress: TOKEN_ADDRESS_B,
                amount: MAX_PER_REQUEST.toString(),
            });

            expect(viemService.readContract).toHaveBeenCalledTimes(2);
            expect(viemService.writeContract).toHaveBeenCalledTimes(2);
        });

        it("should return error entry for a failed token without aborting others", async () => {
            setupConfig();
            viemService.readContract.mockResolvedValue([true, MAX_PER_REQUEST, BigInt(3600)]);
            viemService.writeContract
                .mockResolvedValueOnce(makeTxReceipt("0xaaa") as any)
                .mockRejectedValueOnce(new Error("Transaction reverted"));

            const result = await service.requestTokens(CHAIN_ID, RECIPIENT_ADDRESS, "all-assets");

            // First token succeeded -- top-level receipt reflects that
            expect(result.status).toBe("success");
            expect(result.transactionHash).toBe("0xaaa");
            // Both token entries are present in results
            expect(result.results).toHaveLength(2);
            expect(result.results[0].tokenAddress).toBe(TOKEN_ADDRESS_A);
            expect(result.results[1].tokenAddress).toBe(TOKEN_ADDRESS_B);
        });

        it("should return error entry when a token is not enabled", async () => {
            setupConfig();
            // first token disabled, second enabled
            viemService.readContract
                .mockResolvedValueOnce([false, MAX_PER_REQUEST, BigInt(3600)])
                .mockResolvedValueOnce([true, MAX_PER_REQUEST, BigInt(3600)]);
            viemService.writeContract.mockResolvedValueOnce(makeTxReceipt("0xbbb") as any);

            const result = await service.requestTokens(CHAIN_ID, RECIPIENT_ADDRESS, "all-assets");

            // Second token succeeded -- top-level receipt reflects that
            expect(result.status).toBe("success");
            expect(result.transactionHash).toBe("0xbbb");
            expect(result.results).toHaveLength(2);
            expect(result.results[0].tokenAddress).toBe(TOKEN_ADDRESS_A);
            expect(result.results[1].tokenAddress).toBe(TOKEN_ADDRESS_B);
        });

        it("should throw BadRequestException when operator key is missing", async () => {
            setupConfig({ "OPERATOR_PRIVATE_KEY": undefined });

            await expect(
                service.requestTokens(CHAIN_ID, RECIPIENT_ADDRESS, "all-assets"),
            ).rejects.toThrow(BadRequestException);

            expect(viemService.readContract).not.toHaveBeenCalled();
            expect(viemService.writeContract).not.toHaveBeenCalled();
        });

        it("should throw BadRequestException when faucet address is missing", async () => {
            setupConfig({ [`FAUCET_ADDRESS_${CHAIN_ID}`]: undefined });

            await expect(
                service.requestTokens(CHAIN_ID, RECIPIENT_ADDRESS, "all-assets"),
            ).rejects.toThrow(BadRequestException);

            expect(viemService.readContract).not.toHaveBeenCalled();
        });

        it("should throw BadRequestException when no tokens configured for chain", async () => {
            setupConfig({ [`FAUCET_TOKENS_${CHAIN_ID}`]: undefined });

            await expect(
                service.requestTokens(CHAIN_ID, RECIPIENT_ADDRESS, "all-assets"),
            ).rejects.toThrow(BadRequestException);

            expect(viemService.readContract).not.toHaveBeenCalled();
        });

        it("should return error entry when readContract fails for a token", async () => {
            setupConfig();
            viemService.readContract.mockRejectedValue(new Error("RPC call failed"));

            const result = await service.requestTokens(CHAIN_ID, RECIPIENT_ADDRESS, "all-assets");

            // All tokens failed -- top-level status is "failed"
            expect(result.status).toBe("failed");
            expect(result.transactionHash).toBe(`0x${"0".repeat(64)}`);
            expect(viemService.writeContract).not.toHaveBeenCalled();
        });
    });
});
