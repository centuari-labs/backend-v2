import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { MarketWorker } from "../../market/market.worker";
import { MarketRepositories } from "../../market/repository/market.repository";
import { DatabaseService } from "../../core/database/database.service";
import { Token } from "../../tokens/entities/token.entity";
import { createMockToken } from "../helpers/mock-factories";
import { createMockRepository } from "../helpers/mock-services";

describe("MarketWorker", () => {
    let worker: MarketWorker;
    let marketRepository: jest.Mocked<MarketRepositories>;
    let tokenRepository: jest.Mocked<Repository<Token>>;
    let loggerErrorSpy: jest.SpyInstance;
    let loggerDebugSpy: jest.SpyInstance;
    let loggerLogSpy: jest.SpyInstance;

    beforeAll(() => {
        loggerErrorSpy = jest
            .spyOn(Logger.prototype, "error")
            .mockImplementation(() => {});
        loggerDebugSpy = jest
            .spyOn(Logger.prototype, "debug")
            .mockImplementation(() => {});
        loggerLogSpy = jest
            .spyOn(Logger.prototype, "log")
            .mockImplementation(() => {});
    });

    afterAll(() => {
        loggerErrorSpy.mockRestore();
        loggerDebugSpy.mockRestore();
        loggerLogSpy.mockRestore();
    });

    beforeEach(async () => {
        const mockMarketRepo = {
            ensureMarketsForLoanToken: jest.fn().mockResolvedValue([]),
        };
        const mockTokenRepo = createMockRepository<Token>();

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                MarketWorker,
                { provide: MarketRepositories, useValue: mockMarketRepo },
                { provide: getRepositoryToken(Token), useValue: mockTokenRepo },
            ],
        }).compile();

        worker = module.get(MarketWorker);
        marketRepository = module.get(
            MarketRepositories,
        ) as jest.Mocked<MarketRepositories>;
        tokenRepository = module.get(getRepositoryToken(Token)) as jest.Mocked<
            Repository<Token>
        >;
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("init ordering", () => {
        // Regression (pre-existing bug cc8af16, surfaced 2026-06-02 B4):
        // the eager refresh used to run in onModuleInit, which can fire
        // before DatabaseService.onModuleInit has created the pool — so
        // getPool() returned undefined and .connect() threw. The eager
        // refresh must be deferred to the application-bootstrap phase, which
        // NestJS runs only after every module's onModuleInit has completed.
        it("does not run the eager maturities refresh in onModuleInit", async () => {
            // A loan token is present, so the buggy code path (refresh in
            // onModuleInit) would reach ensureMarketsForLoanToken. The fixed
            // code defers the refresh, so onModuleInit must touch nothing.
            tokenRepository.find.mockResolvedValue([createMockToken()]);

            const maybeOnModuleInit = (
                worker as unknown as { onModuleInit?: () => Promise<void> }
            ).onModuleInit;

            if (maybeOnModuleInit) {
                await maybeOnModuleInit.call(worker);
            }

            expect(
                marketRepository.ensureMarketsForLoanToken,
            ).not.toHaveBeenCalled();
        });

        it("runs the eager maturities refresh in onApplicationBootstrap", async () => {
            tokenRepository.find.mockResolvedValue([createMockToken()]);

            await worker.onApplicationBootstrap();

            expect(tokenRepository.find).toHaveBeenCalledWith({
                where: { isLoanToken: true },
            });
            expect(
                marketRepository.ensureMarketsForLoanToken,
            ).toHaveBeenCalled();
        });
    });

    describe("ensureFutureMaturitiesForLoanTokens", () => {
        it("ensures the 1/3/6/12-month maturities for each loan token", async () => {
            const usdc = createMockToken({ symbol: "USDC" });
            const usdt = createMockToken({ symbol: "USDT" });
            tokenRepository.find.mockResolvedValue([usdc, usdt]);

            await worker.ensureFutureMaturitiesForLoanTokens();

            expect(
                marketRepository.ensureMarketsForLoanToken,
            ).toHaveBeenCalledTimes(2);
            const [, maturities] =
                marketRepository.ensureMarketsForLoanToken.mock.calls[0];
            expect(maturities).toHaveLength(4);
        });

        it("does not throw when the repository fails", async () => {
            tokenRepository.find.mockResolvedValue([createMockToken()]);
            marketRepository.ensureMarketsForLoanToken.mockRejectedValue(
                new Error("DB connection failed"),
            );

            await expect(
                worker.ensureFutureMaturitiesForLoanTokens(),
            ).resolves.toBeUndefined();
        });
    });

    describe("DB pool readiness (lifecycle ordering)", () => {
        // Deterministic proof of the root-cause fix. NestJS guarantees every
        // module's onModuleInit completes before any onApplicationBootstrap
        // runs. We replay that guarantee against the real DatabaseService:
        // the worker's hook must be onApplicationBootstrap, so by the time it
        // queries, DatabaseService.onModuleInit has already created the pool.
        // The repo mock reproduces the original crash (getPool().connect() on
        // an undefined pool) to assert the worker never runs while the pool
        // is missing.
        it("queries only after DatabaseService.onModuleInit has created the pool", async () => {
            const db = new DatabaseService();
            marketRepository.ensureMarketsForLoanToken.mockImplementation(
                async () => {
                    if (!db.getPool()) {
                        throw new TypeError(
                            "Cannot read properties of undefined (reading 'connect')",
                        );
                    }
                    return [];
                },
            );
            tokenRepository.find.mockResolvedValue([createMockToken()]);

            // The worker exposes its eager refresh via onApplicationBootstrap,
            // not onModuleInit — so it cannot fire during the module-init
            // phase (pool still undefined).
            expect(
                (worker as unknown as { onModuleInit?: unknown }).onModuleInit,
            ).toBeUndefined();

            // Simulate NestJS lifecycle order: all onModuleInit hooks first…
            await db.onModuleInit();
            // …then onApplicationBootstrap hooks.
            await worker.onApplicationBootstrap();

            expect(
                marketRepository.ensureMarketsForLoanToken,
            ).toHaveBeenCalled();
            expect(loggerErrorSpy).not.toHaveBeenCalled();

            await db.onModuleDestroy();
        });
    });
});
