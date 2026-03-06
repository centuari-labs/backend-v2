import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DepositService } from "../../deposit/deposit.service";
import { ViemService } from "../../core/viem/viem.service";
import { TokensService } from "../../tokens/tokens.service";
import { TokensRepository } from "../../tokens/repositories/tokens.repository";

describe("DepositService", () => {
    let service: DepositService;
    let viemService: jest.Mocked<ViemService>;
    let tokensRepository: jest.Mocked<TokensRepository>;
    let loggerSpy: jest.SpyInstance;

    const WALLET_ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
    const ASSET_ID = "11111111-1111-1111-1111-111111111111";
    const TOKEN_ADDRESS = "0xdAC17F958D2ee523a2206206994597C13D831ec7";

    const mockToken = {
        id: ASSET_ID,
        symbol: "USDT",
        name: "Tether",
        tokenAddress: TOKEN_ADDRESS,
        decimals: 6,
        chainId: 421614,
        imageUrl: null,
        isLoanToken: false,
        averageLTV: null,
        coingeckoId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    beforeAll(() => {
        loggerSpy = jest
            .spyOn(Logger.prototype, "error")
            .mockImplementation(() => {});
        jest.spyOn(Logger.prototype, "log").mockImplementation(() => {});
        jest.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
        jest.spyOn(Logger.prototype, "debug").mockImplementation(() => {});
    });

    afterAll(() => {
        loggerSpy.mockRestore();
    });

    beforeEach(async () => {
        jest.clearAllMocks();

        const mockViemService: Partial<jest.Mocked<ViemService>> = {
            readContract: jest.fn(),
        };

        const mockTokensService: Partial<jest.Mocked<TokensService>> = {
            getTokenByAssetId: jest.fn().mockResolvedValue(mockToken),
        };

        const mockTokensRepository: Partial<jest.Mocked<TokensRepository>> = {
            findDepositTokens: jest.fn().mockResolvedValue([mockToken]),
        };

        const mockConfigService: Partial<jest.Mocked<ConfigService>> = {
            get: jest.fn().mockImplementation((key: string) => {
                const config: Record<string, string> = {
                    NODE_ENV: "production",
                    DEPOSIT_CHAIN_ID: "421614",
                };
                return config[key];
            }),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                DepositService,
                { provide: ViemService, useValue: mockViemService },
                { provide: TokensService, useValue: mockTokensService },
                { provide: TokensRepository, useValue: mockTokensRepository },
                { provide: ConfigService, useValue: mockConfigService },
            ],
        }).compile();

        service = module.get(DepositService);
        viemService = module.get(ViemService);
        tokensRepository = module.get(TokensRepository);
    });

    describe("getBalance", () => {
        it("should return formatted balance from chain", async () => {
            // 1000 USDT with 6 decimals
            viemService.readContract.mockResolvedValue(
                BigInt("1000000000"),
            );

            const result = await service.getBalance(
                ASSET_ID,
                WALLET_ADDRESS,
            );

            expect(result.balance).toBe("1000000000");
            expect(result.formattedBalance).toBe("1000");
            expect(result.decimals).toBe(6);
            expect(result.symbol).toBe("USDT");
        });
    });

    describe("getDepositTokens", () => {
        it("should return mapped token list", async () => {
            const result = await service.getDepositTokens();

            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({
                id: ASSET_ID,
                symbol: "USDT",
                name: "Tether",
                tokenAddress: TOKEN_ADDRESS,
                decimals: 6,
                imageUrl: null,
                chainId: 421614,
            });
        });
    });
});
