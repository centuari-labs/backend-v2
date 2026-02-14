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

            const decimals = await service.getTokenDecimalsByAssetId(mockToken.id);

            expect(decimals).toBe(mockToken.decimals);
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
