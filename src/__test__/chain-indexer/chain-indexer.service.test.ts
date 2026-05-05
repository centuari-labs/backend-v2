jest.mock("jose", () => ({}));
jest.mock("../../core/privy/privy.service");

import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { getRepositoryToken } from "@nestjs/typeorm";
import { ChainIndexerService } from "../../chain-indexer/chain-indexer.service";
import { ViemService } from "../../core/viem/viem.service";
import { ChainConfigService } from "../../core/chain-config/chain-config.service";
import { DatabaseService } from "../../core/database/database.service";
import { PortfolioRepository } from "../../portfolio/repositories/portfolio.repository";
import { Account } from "../../orders/entities/account.entity";
import { Token } from "../../tokens/entities/token.entity";
import {
    createMockDatabaseService,
    createMockViemServiceFull,
    createMockChainConfigService,
    createMockConfigService,
    createMockRepository,
} from "../helpers/mock-services";
import { createMockAccount, createMockToken } from "../helpers/mock-factories";

// Mock viem's parseAbiItem and parseEventLogs at module level
jest.mock("viem", () => ({
    parseAbiItem: jest.fn().mockReturnValue({}),
    parseEventLogs: jest.fn().mockReturnValue([]),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseEventLogs } = require("viem");

describe("ChainIndexerService", () => {
    let service: ChainIndexerService;
    let databaseService: ReturnType<typeof createMockDatabaseService>;
    let viemService: ReturnType<typeof createMockViemServiceFull>;
    let chainConfig: ReturnType<typeof createMockChainConfigService>;
    let portfolioRepository: { upsertPortfolio: jest.Mock };
    let accountRepository: ReturnType<typeof createMockRepository>;
    let tokenRepository: ReturnType<typeof createMockRepository>;

    beforeEach(async () => {
        databaseService = createMockDatabaseService();
        viemService = createMockViemServiceFull();
        chainConfig = createMockChainConfigService();
        portfolioRepository = { upsertPortfolio: jest.fn() };
        accountRepository = createMockRepository();
        tokenRepository = createMockRepository();

        const configOverrides: Record<string, any> = {
            INDEXER_START_BLOCK: "100",
            CHAIN_INDEXER_ENABLED: "true",
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ChainIndexerService,
                { provide: ViemService, useValue: viemService },
                { provide: DatabaseService, useValue: databaseService },
                {
                    provide: PortfolioRepository,
                    useValue: portfolioRepository,
                },
                {
                    provide: getRepositoryToken(Account),
                    useValue: accountRepository,
                },
                {
                    provide: getRepositoryToken(Token),
                    useValue: tokenRepository,
                },
                {
                    provide: ConfigService,
                    useValue: createMockConfigService(configOverrides),
                },
                {
                    provide: ChainConfigService,
                    useValue: chainConfig,
                },
            ],
        }).compile();

        service = module.get<ChainIndexerService>(ChainIndexerService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("processTransactionDeposits", () => {
        const mockTxHash = "0xabc123";

        it("should process deposit events from successful transaction", async () => {
            const mockAccount = createMockAccount({
                userWallet: "0xuser",
            });
            const mockToken = createMockToken({
                tokenAddress: "0xtoken",
            });

            viemService.getTransactionReceipt.mockResolvedValue({
                status: "success",
                logs: [],
            });

            (parseEventLogs as jest.Mock).mockReturnValue([
                {
                    address: chainConfig.treasuryAddress,
                    logIndex: 0,
                    args: {
                        user: "0xUser",
                        token: "0xToken",
                        amount: BigInt("1000000"),
                    },
                },
            ]);

            // markAsProcessed returns true (new event)
            databaseService.query.mockResolvedValueOnce([
                { tx_hash: mockTxHash },
            ]);

            // Account lookup
            const mockQb = {
                where: jest.fn().mockReturnThis(),
                getOne: jest.fn().mockResolvedValue(mockAccount),
            };
            (accountRepository.createQueryBuilder as jest.Mock).mockReturnValue(
                mockQb,
            );

            // Token lookup
            const mockTokenQb = {
                where: jest.fn().mockReturnThis(),
                getOne: jest.fn().mockResolvedValue(mockToken),
            };
            (tokenRepository.createQueryBuilder as jest.Mock).mockReturnValue(
                mockTokenQb,
            );

            const result = await service.processTransactionDeposits(mockTxHash);

            expect(result).toBe(1);
            expect(portfolioRepository.upsertPortfolio).toHaveBeenCalled();
        });

        it("should return 0 for reverted transaction", async () => {
            viemService.getTransactionReceipt.mockResolvedValue({
                status: "reverted",
                logs: [],
            });

            const result = await service.processTransactionDeposits(mockTxHash);

            expect(result).toBe(0);
        });

        it("should skip already-processed events (duplicate detection)", async () => {
            viemService.getTransactionReceipt.mockResolvedValue({
                status: "success",
                logs: [],
            });

            (parseEventLogs as jest.Mock).mockReturnValue([
                {
                    address: chainConfig.treasuryAddress,
                    logIndex: 0,
                    args: {
                        user: "0xUser",
                        token: "0xToken",
                        amount: BigInt("1000000"),
                    },
                },
            ]);

            // markAsProcessed returns empty (already processed)
            databaseService.query.mockResolvedValueOnce([]);

            const result = await service.processTransactionDeposits(mockTxHash);

            expect(result).toBe(0);
            expect(portfolioRepository.upsertPortfolio).not.toHaveBeenCalled();
        });

        it("should skip deposit when no matching account exists", async () => {
            viemService.getTransactionReceipt.mockResolvedValue({
                status: "success",
                logs: [],
            });

            (parseEventLogs as jest.Mock).mockReturnValue([
                {
                    address: chainConfig.treasuryAddress,
                    logIndex: 0,
                    args: {
                        user: "0xUnknownUser",
                        token: "0xToken",
                        amount: BigInt("1000000"),
                    },
                },
            ]);

            // markAsProcessed returns true
            databaseService.query.mockResolvedValueOnce([
                { tx_hash: mockTxHash },
            ]);

            // Account not found
            const mockQb = {
                where: jest.fn().mockReturnThis(),
                getOne: jest.fn().mockResolvedValue(null),
            };
            (accountRepository.createQueryBuilder as jest.Mock).mockReturnValue(
                mockQb,
            );

            const result = await service.processTransactionDeposits(mockTxHash);

            expect(result).toBe(0);
            expect(portfolioRepository.upsertPortfolio).not.toHaveBeenCalled();
        });

        it("should skip deposit when no matching token exists", async () => {
            const mockAccount = createMockAccount();

            viemService.getTransactionReceipt.mockResolvedValue({
                status: "success",
                logs: [],
            });

            (parseEventLogs as jest.Mock).mockReturnValue([
                {
                    address: chainConfig.treasuryAddress,
                    logIndex: 0,
                    args: {
                        user: "0xUser",
                        token: "0xUnknownToken",
                        amount: BigInt("1000000"),
                    },
                },
            ]);

            // markAsProcessed returns true
            databaseService.query.mockResolvedValueOnce([
                { tx_hash: mockTxHash },
            ]);

            // Account found
            const mockQb = {
                where: jest.fn().mockReturnThis(),
                getOne: jest.fn().mockResolvedValue(mockAccount),
            };
            (accountRepository.createQueryBuilder as jest.Mock).mockReturnValue(
                mockQb,
            );

            // Token not found
            const mockTokenQb = {
                where: jest.fn().mockReturnThis(),
                getOne: jest.fn().mockResolvedValue(null),
            };
            (tokenRepository.createQueryBuilder as jest.Mock).mockReturnValue(
                mockTokenQb,
            );

            const result = await service.processTransactionDeposits(mockTxHash);

            expect(result).toBe(0);
            expect(portfolioRepository.upsertPortfolio).not.toHaveBeenCalled();
        });
    });

    describe("poll", () => {
        it("should skip when disabled", async () => {
            // Create a disabled service
            const configOverrides: Record<string, any> = {
                INDEXER_START_BLOCK: "0",
                CHAIN_INDEXER_ENABLED: "false",
            };

            const module: TestingModule = await Test.createTestingModule({
                providers: [
                    ChainIndexerService,
                    { provide: ViemService, useValue: viemService },
                    {
                        provide: DatabaseService,
                        useValue: databaseService,
                    },
                    {
                        provide: PortfolioRepository,
                        useValue: portfolioRepository,
                    },
                    {
                        provide: getRepositoryToken(Account),
                        useValue: accountRepository,
                    },
                    {
                        provide: getRepositoryToken(Token),
                        useValue: tokenRepository,
                    },
                    {
                        provide: ConfigService,
                        useValue: createMockConfigService(configOverrides),
                    },
                    {
                        provide: ChainConfigService,
                        useValue: chainConfig,
                    },
                ],
            }).compile();

            const disabledService =
                module.get<ChainIndexerService>(ChainIndexerService);
            await disabledService.poll();

            expect(viemService.getPublicClient).not.toHaveBeenCalled();
        });

        it("should skip when treasuryAddress not set", async () => {
            const configOverrides: Record<string, any> = {
                INDEXER_START_BLOCK: "0",
                CHAIN_INDEXER_ENABLED: "true",
            };
            const noTreasuryConfig = {
                ...createMockChainConfigService(),
                treasuryAddress: "",
            };

            const module: TestingModule = await Test.createTestingModule({
                providers: [
                    ChainIndexerService,
                    { provide: ViemService, useValue: viemService },
                    {
                        provide: DatabaseService,
                        useValue: databaseService,
                    },
                    {
                        provide: PortfolioRepository,
                        useValue: portfolioRepository,
                    },
                    {
                        provide: getRepositoryToken(Account),
                        useValue: accountRepository,
                    },
                    {
                        provide: getRepositoryToken(Token),
                        useValue: tokenRepository,
                    },
                    {
                        provide: ConfigService,
                        useValue: createMockConfigService(configOverrides),
                    },
                    {
                        provide: ChainConfigService,
                        useValue: noTreasuryConfig,
                    },
                ],
            }).compile();

            const noTreasuryService =
                module.get<ChainIndexerService>(ChainIndexerService);
            await noTreasuryService.poll();

            expect(viemService.getPublicClient).not.toHaveBeenCalled();
        });
    });

    describe("state management", () => {
        it("should create state row on init if not exists", async () => {
            databaseService.queryOne.mockResolvedValue(null);
            databaseService.query.mockResolvedValue([]);

            await service.onModuleInit();

            expect(databaseService.queryOne).toHaveBeenCalledWith(
                expect.stringContaining("SELECT id FROM indexer_state"),
                ["treasury-deposited"],
            );
            expect(databaseService.query).toHaveBeenCalledWith(
                expect.stringContaining("INSERT INTO indexer_state"),
                ["treasury-deposited", "100"],
            );
        });

        it("should not duplicate state row if already exists", async () => {
            databaseService.queryOne.mockResolvedValue({
                id: "treasury-deposited",
            });

            await service.onModuleInit();

            expect(databaseService.queryOne).toHaveBeenCalledWith(
                expect.stringContaining("SELECT id FROM indexer_state"),
                ["treasury-deposited"],
            );
            // Should NOT call INSERT
            expect(databaseService.query).not.toHaveBeenCalledWith(
                expect.stringContaining("INSERT INTO indexer_state"),
                expect.anything(),
            );
        });
    });
});
