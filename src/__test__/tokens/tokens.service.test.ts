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

    describe("validateToken", () => {
        it("should return token for valid active address", async () => {
            tokensRepository.validateToken.mockResolvedValue(mockToken);

            const result = await service.validateToken(mockToken.tokenAddress);

            expect(result).toEqual(mockToken);
            expect(tokensRepository.validateToken).toHaveBeenCalledWith(
                mockToken.tokenAddress,
            );
        });

        it("should throw BadRequestException for unknown token address", async () => {
            tokensRepository.validateToken.mockResolvedValue(null);

            await expect(
                service.validateToken("0xUnknownToken12345678901234567890123456"),
            ).rejects.toThrow(BadRequestException);
        });

        it("should include error message with token address", async () => {
            const unknownAddress = "0xUnknownToken12345678901234567890123456";
            tokensRepository.validateToken.mockResolvedValue(null);

            await expect(service.validateToken(unknownAddress)).rejects.toThrow(
                `Token ${unknownAddress} is not supported`,
            );
        });

        it("should return avg_ltv from database for loan tokens", async () => {
            const loanTokenWithAvgLtv = { ...mockToken, averageLTV: 0.75 };
            tokensRepository.validateToken.mockResolvedValue(
                loanTokenWithAvgLtv as Token,
            );

            const result = await service.validateToken(mockToken.tokenAddress);

            expect(result.averageLTV).toBe(0.75);
        });

        it("should return null avg_ltv when no risk records exist", async () => {
            const loanTokenWithNullAvgLtv = { ...mockToken, averageLTV: null };
            tokensRepository.validateToken.mockResolvedValue(
                loanTokenWithNullAvgLtv as Token,
            );

            const result = await service.validateToken(mockToken.tokenAddress);

            expect(result.averageLTV).toBeNull();
        });
    });

    describe("token data integrity", () => {
        it("should return complete token data with all fields", async () => {
            tokensRepository.validateToken.mockResolvedValue(mockToken);

            const result = await service.validateToken(mockToken.tokenAddress);

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
            tokensRepository.validateToken.mockResolvedValue(
                tokenWithNullChainId as Token,
            );

            const result = await service.validateToken(mockToken.tokenAddress);

            expect(result.chainId).toBeNull();
        });
    });
});
