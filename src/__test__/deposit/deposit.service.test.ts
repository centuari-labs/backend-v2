import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DepositService } from "../../deposit/deposit.service";
import { ViemService } from "../../core/viem/viem.service";
import { TokensService } from "../../tokens/tokens.service";
import { TokensRepository } from "../../tokens/repositories/tokens.repository";

// Mock @privy-io/server-auth
jest.mock("@privy-io/server-auth", () => {
    const mockSendTransaction = jest.fn();
    const mockUpdateAuthorizationKey = jest.fn();
    const mockGenerateUserSigner = jest.fn();

    return {
        PrivyClient: jest.fn().mockImplementation(() => ({
            walletApi: {
                generateUserSigner: mockGenerateUserSigner,
                updateAuthorizationKey: mockUpdateAuthorizationKey,
                ethereum: {
                    sendTransaction: mockSendTransaction,
                },
            },
        })),
        __mockSendTransaction: mockSendTransaction,
        __mockUpdateAuthorizationKey: mockUpdateAuthorizationKey,
        __mockGenerateUserSigner: mockGenerateUserSigner,
    };
});

const {
    __mockSendTransaction: mockSendTransaction,
    __mockGenerateUserSigner: mockGenerateUserSigner,
} = jest.requireMock("@privy-io/server-auth");

describe("DepositService", () => {
    let service: DepositService;
    let viemService: jest.Mocked<ViemService>;
    let tokensService: jest.Mocked<TokensService>;
    let tokensRepository: jest.Mocked<TokensRepository>;
    let configService: jest.Mocked<ConfigService>;
    let loggerSpy: jest.SpyInstance;

    const WALLET_ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
    const BEARER_TOKEN = "test-jwt-token";
    const ASSET_ID = "11111111-1111-1111-1111-111111111111";
    const TOKEN_ADDRESS = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
    const TREASURY_ADDRESS = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

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
                    TREASURY_ADDRESS: TREASURY_ADDRESS,
                    DEPOSIT_CHAIN_ID: "421614",
                    PRIVY_APP_ID: "test-app-id",
                    PRIVY_PROJECT_SECRET: "test-secret",
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
        tokensService = module.get(TokensService);
        tokensRepository = module.get(TokensRepository);
        configService = module.get(ConfigService);
    });

    describe("deposit", () => {
        it("should submit a deposit transaction via Privy wallet API", async () => {
            const walletId = "wallet-123";
            mockGenerateUserSigner.mockResolvedValue({
                authorizationKey: "auth-key-123",
                expiresAt: new Date(Date.now() + 600000),
                wallets: [
                    {
                        id: walletId,
                        address: WALLET_ADDRESS,
                        chainType: "ethereum",
                        policyIds: [],
                    },
                ],
            });
            mockSendTransaction.mockResolvedValue({
                hash: "0xabc123",
            });

            const result = await service.deposit(
                ASSET_ID,
                "100",
                WALLET_ADDRESS,
                BEARER_TOKEN,
            );

            expect(result.transactionHash).toBe("0xabc123");
            expect(result.status).toBe("submitted");
            expect(mockGenerateUserSigner).toHaveBeenCalledWith({
                userJwt: BEARER_TOKEN,
            });
            expect(mockSendTransaction).toHaveBeenCalledWith(
                expect.objectContaining({
                    walletId,
                    caip2: "eip155:421614",
                }),
            );
        });

        it("should throw when no matching wallet is found", async () => {
            mockGenerateUserSigner.mockResolvedValue({
                authorizationKey: "auth-key-123",
                expiresAt: new Date(Date.now() + 600000),
                wallets: [
                    {
                        id: "wallet-other",
                        address: "0xOtherAddress",
                        chainType: "ethereum",
                        policyIds: [],
                    },
                ],
            });

            await expect(
                service.deposit(ASSET_ID, "100", WALLET_ADDRESS, BEARER_TOKEN),
            ).rejects.toThrow(BadRequestException);
        });
    });

    describe("deposit (dev mode)", () => {
        let devService: DepositService;

        beforeEach(async () => {
            const mockConfigDev: Partial<jest.Mocked<ConfigService>> = {
                get: jest.fn().mockImplementation((key: string) => {
                    const config: Record<string, string> = {
                        NODE_ENV: "development",
                        DEPOSIT_CHAIN_ID: "421614",
                        PRIVY_APP_ID: "test-app-id",
                        PRIVY_PROJECT_SECRET: "test-secret",
                    };
                    return config[key];
                }),
            };

            const module: TestingModule = await Test.createTestingModule({
                providers: [
                    DepositService,
                    {
                        provide: ViemService,
                        useValue: { readContract: jest.fn() },
                    },
                    { provide: TokensService, useValue: tokensService },
                    {
                        provide: TokensRepository,
                        useValue: tokensRepository,
                    },
                    { provide: ConfigService, useValue: mockConfigDev },
                ],
            }).compile();

            devService = module.get(DepositService);
        });

        it("should return mock response in dev mode", async () => {
            const result = await devService.deposit(
                ASSET_ID,
                "100",
                WALLET_ADDRESS,
                BEARER_TOKEN,
            );

            expect(result.status).toBe("submitted");
            expect(result.transactionHash).toBe(`0x${"0".repeat(64)}`);
            expect(mockGenerateUserSigner).not.toHaveBeenCalled();
        });
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
