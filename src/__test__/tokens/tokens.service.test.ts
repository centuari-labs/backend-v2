import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException } from "@nestjs/common";
import { TokensService } from "../../tokens/tokens.service";
import { Token } from "../../tokens/entities/token.entity";
import { TokensRepository } from "../../tokens/repositories/tokens.repository";

describe("TokensService", () => {
    let service: TokensService;
    let tokensRepository: jest.Mocked<TokensRepository>;

    const mockToken: Token = {
        id: "uuid-token-001",
        tokenAddress: "0xToken1234567890abcdef1234567890abcdef12",
        symbol: "USDC",
        name: "USD Coin",
        isLoanToken: true,
        chainId: 84532,
        decimals: 6,
        averageLTV: 0.75,
        coingeckoId: "usd-coin",
        imageUrl: "https://example.com/image.png",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    beforeEach(async () => {
        const mockTokensRepository: jest.Mocked<TokensRepository> = {
            validateToken: jest.fn(),
            getActiveTokens: jest.fn(),
            findByAssetId: jest.fn(),
        } as any;

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                TokensService,
                {
                    provide: TokensRepository,
                    useValue: mockTokensRepository,
                },
            ],
        }).compile();

        service = module.get<TokensService>(TokensService);
        tokensRepository = module.get(TokensRepository);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("validateTokenByAssetId (primary path)", () => {
        it("should return token for valid asset id", async () => {
            tokensRepository.getActiveTokens.mockResolvedValue([]);
            tokensRepository.findByAssetId.mockResolvedValue(mockToken);

            const result = await service.validateTokenByAssetId(mockToken.id);

            expect(result).toEqual(mockToken);
            expect(tokensRepository.findByAssetId).toHaveBeenCalledWith(
                mockToken.id,
            );
        });

        it("should throw BadRequestException for unknown asset id", async () => {
            tokensRepository.getActiveTokens.mockResolvedValue([]);
            tokensRepository.findByAssetId.mockResolvedValue(null);

            await expect(
                service.validateTokenByAssetId("unknown-asset-id"),
            ).rejects.toThrow(BadRequestException);
        });

        it("should include error message with asset id", async () => {
            const unknownAssetId = "unknown-asset-id";
            tokensRepository.getActiveTokens.mockResolvedValue([]);
            tokensRepository.findByAssetId.mockResolvedValue(null);

            await expect(
                service.validateTokenByAssetId(unknownAssetId),
            ).rejects.toThrow(`Token ${unknownAssetId} is not supported`);
        });

        it("should return avg_ltv from database for loan tokens", async () => {
            const loanTokenWithAvgLtv = { ...mockToken, averageLTV: 0.75 };
            tokensRepository.getActiveTokens.mockResolvedValue([]);
            tokensRepository.findByAssetId.mockResolvedValue(
                loanTokenWithAvgLtv as Token,
            );

            const result = await service.validateTokenByAssetId(mockToken.id);

            expect(result.averageLTV).toBe(0.75);
        });

        it("should return null avg_ltv when no risk records exist", async () => {
            const loanTokenWithNullAvgLtv = { ...mockToken, averageLTV: null };
            tokensRepository.getActiveTokens.mockResolvedValue([]);
            tokensRepository.findByAssetId.mockResolvedValue(
                loanTokenWithNullAvgLtv as Token,
            );

            const result = await service.validateTokenByAssetId(mockToken.id);

            expect(result.averageLTV).toBeNull();
        });
    });

    describe("asset-id-based cache", () => {
        it("should load all tokens into cache on first access", async () => {
            tokensRepository.getActiveTokens.mockResolvedValue([mockToken]);
            tokensRepository.findByAssetId.mockResolvedValue(mockToken);

            const result = await service.validateTokenByAssetId(mockToken.id);

            expect(tokensRepository.getActiveTokens).toHaveBeenCalledTimes(1);
            expect(result).toEqual(mockToken);
        });

        it("should return token from cache when available", async () => {
            tokensRepository.getActiveTokens.mockResolvedValue([mockToken]);
            tokensRepository.findByAssetId.mockResolvedValue(null);

            // First call will populate cache via getActiveTokens
            await service.validateTokenByAssetId(mockToken.id);
            tokensRepository.findByAssetId.mockClear();

            // Second call should hit cache only
            const result = await service.validateTokenByAssetId(mockToken.id);

            expect(result).toEqual(mockToken);
            expect(tokensRepository.findByAssetId).not.toHaveBeenCalled();
        });

        it("should fall back to DB when token not in cache", async () => {
            tokensRepository.getActiveTokens.mockResolvedValue([]);
            tokensRepository.findByAssetId.mockResolvedValue(mockToken);

            const result = await service.validateTokenByAssetId(mockToken.id);

            expect(tokensRepository.findByAssetId).toHaveBeenCalledWith(
                mockToken.id,
            );
            expect(result).toEqual(mockToken);
        });

        it("should throw BadRequestException for unknown asset id", async () => {
            tokensRepository.getActiveTokens.mockResolvedValue([]);
            tokensRepository.findByAssetId.mockResolvedValue(null);

            await expect(
                service.validateTokenByAssetId("unknown-asset-id"),
            ).rejects.toThrow(BadRequestException);
        });

        it("should return decimals via getTokenDecimalsByAssetId", async () => {
            tokensRepository.getActiveTokens.mockResolvedValue([mockToken]);
            tokensRepository.findByAssetId.mockResolvedValue(mockToken);

            const decimals = await service.getTokenDecimalsByAssetId(
                mockToken.id,
            );

            expect(decimals).toBe(mockToken.decimals);
        });
    });

    describe("edge cases", () => {
        it("should be case-insensitive on assetId lookup", async () => {
            tokensRepository.getActiveTokens.mockResolvedValue([mockToken]);

            // Access with uppercase ID — cache stores lowercased keys
            const result = await service.validateTokenByAssetId(
                mockToken.id.toUpperCase(),
            );

            expect(result).toEqual(mockToken);
            expect(tokensRepository.findByAssetId).not.toHaveBeenCalled();
        });

        it("should add DB-fetched token to cache for subsequent lookups", async () => {
            tokensRepository.getActiveTokens.mockResolvedValue([]);
            tokensRepository.findByAssetId.mockResolvedValue(mockToken);

            // First call: cache miss, fetches from DB
            await service.validateTokenByAssetId(mockToken.id);
            expect(tokensRepository.findByAssetId).toHaveBeenCalledTimes(1);

            // Second call: should be cached now
            tokensRepository.findByAssetId.mockClear();
            const result = await service.validateTokenByAssetId(mockToken.id);

            expect(result).toEqual(mockToken);
            expect(tokensRepository.findByAssetId).not.toHaveBeenCalled();
        });

        it("should return null decimals via getTokenDecimalsByAssetId when token.decimals is null", async () => {
            const tokenNullDecimals = { ...mockToken, decimals: null };
            tokensRepository.getActiveTokens.mockResolvedValue([
                tokenNullDecimals as Token,
            ]);

            const decimals = await service.getTokenDecimalsByAssetId(
                mockToken.id,
            );

            expect(decimals).toBeNull();
        });

        it("should serve getTokenByAssetId as alias for validateTokenByAssetId", async () => {
            tokensRepository.getActiveTokens.mockResolvedValue([mockToken]);

            const result = await service.getTokenByAssetId(mockToken.id);

            expect(result).toEqual(mockToken);
        });

        it("should share same init promise for concurrent calls", async () => {
            tokensRepository.getActiveTokens.mockResolvedValue([mockToken]);

            // Trigger two concurrent calls before cache is populated
            const [result1, result2] = await Promise.all([
                service.validateTokenByAssetId(mockToken.id),
                service.validateTokenByAssetId(mockToken.id),
            ]);

            expect(result1).toEqual(mockToken);
            expect(result2).toEqual(mockToken);
            // getActiveTokens should have been called at most twice
            // (once from onModuleInit, once from ensureCacheInitialized or shared)
        });
    });

    describe("token data integrity", () => {
        it("should return complete token data with all fields", async () => {
            tokensRepository.getActiveTokens.mockResolvedValue([]);
            tokensRepository.findByAssetId.mockResolvedValue(mockToken);

            const result = await service.validateTokenByAssetId(mockToken.id);

            expect(result).toHaveProperty("id");
            expect(result).toHaveProperty("tokenAddress");
            expect(result).toHaveProperty("symbol");
            expect(result).toHaveProperty("name");
            expect(result).toHaveProperty("isLoanToken");
            expect(result).toHaveProperty("chainId");
            expect(result).toHaveProperty("createdAt");
            expect(result).toHaveProperty("updatedAt");
            expect(result).toHaveProperty("averageLTV");
        });

        it("should handle token with null chainId", async () => {
            const tokenWithNullChainId = { ...mockToken, chainId: null };
            tokensRepository.getActiveTokens.mockResolvedValue([]);
            tokensRepository.findByAssetId.mockResolvedValue(
                tokenWithNullChainId as Token,
            );

            const result = await service.validateTokenByAssetId(mockToken.id);

            expect(result.chainId).toBeNull();
        });
    });
});
