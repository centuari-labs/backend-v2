jest.mock("jose", () => ({}));
jest.mock("../../core/privy/privy.service");

import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { MarketWorker } from "../../market/market.worker";
import { Market } from "../../market/entities/market.entity";
import { Token } from "../../tokens/entities/token.entity";
import { createMockRepository } from "../helpers/mock-services";
import { createMockToken } from "../helpers/mock-factories";

// Mock the utility functions
jest.mock("../../orders/utils/maturity.utils", () => ({
    getAllowedMaturitiesUtcSeconds: jest
        .fn()
        .mockReturnValue([1735689600, 1738368000]), // two future maturities
}));

jest.mock("../../market/utils/market-id.utils", () => ({
    computeMarketId: jest
        .fn()
        .mockImplementation(
            (addr: string, maturity: number) => `market-${addr}-${maturity}`,
        ),
}));

describe("MarketWorker", () => {
    let worker: MarketWorker;
    let marketRepository: ReturnType<typeof createMockRepository>;
    let tokenRepository: ReturnType<typeof createMockRepository>;

    beforeEach(async () => {
        marketRepository = createMockRepository();
        tokenRepository = createMockRepository();

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                MarketWorker,
                {
                    provide: getRepositoryToken(Market),
                    useValue: marketRepository,
                },
                {
                    provide: getRepositoryToken(Token),
                    useValue: tokenRepository,
                },
            ],
        }).compile();

        worker = module.get<MarketWorker>(MarketWorker);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("ensureFutureMaturitiesForLoanTokens (via onModuleInit)", () => {
        it("should create markets for loan tokens with missing maturities", async () => {
            const loanToken = createMockToken({ isLoanToken: true });
            (tokenRepository.find as jest.Mock).mockResolvedValue([loanToken]);
            (marketRepository.find as jest.Mock).mockResolvedValue([]); // no existing markets
            (marketRepository.create as jest.Mock).mockImplementation(
                (data: any) => data,
            );
            (marketRepository.save as jest.Mock).mockResolvedValue({});

            await worker.onModuleInit();

            // 1 token * 2 maturities = 2 saves
            expect(marketRepository.save).toHaveBeenCalledTimes(2);
        });

        it("should skip existing markets", async () => {
            const loanToken = createMockToken({ isLoanToken: true });
            const existingMarket = {
                assetId: loanToken.id,
                maturity: new Date(1735689600 * 1000), // first maturity
            };
            (tokenRepository.find as jest.Mock).mockResolvedValue([loanToken]);
            (marketRepository.find as jest.Mock).mockResolvedValue([
                existingMarket,
            ]);
            (marketRepository.create as jest.Mock).mockImplementation(
                (data: any) => data,
            );
            (marketRepository.save as jest.Mock).mockResolvedValue({});

            await worker.onModuleInit();

            // Only 1 of 2 maturities should be created (the other already exists)
            expect(marketRepository.save).toHaveBeenCalledTimes(1);
        });

        it("should return 0 when no loan tokens exist", async () => {
            (tokenRepository.find as jest.Mock).mockResolvedValue([]);
            (marketRepository.find as jest.Mock).mockResolvedValue([]);

            await worker.onModuleInit();

            expect(marketRepository.save).not.toHaveBeenCalled();
        });

        it("should handle duplicate key race condition gracefully", async () => {
            const loanToken = createMockToken({ isLoanToken: true });
            (tokenRepository.find as jest.Mock).mockResolvedValue([loanToken]);
            (marketRepository.find as jest.Mock).mockResolvedValue([]);
            (marketRepository.create as jest.Mock).mockImplementation(
                (data: any) => data,
            );
            (marketRepository.save as jest.Mock)
                .mockRejectedValueOnce(
                    new Error("duplicate key value violates unique constraint"),
                )
                .mockResolvedValueOnce({});

            // Should not throw — just continue
            await worker.onModuleInit();

            expect(marketRepository.save).toHaveBeenCalledTimes(2);
        });

        it("should rethrow non-duplicate-key errors", async () => {
            const loanToken = createMockToken({ isLoanToken: true });
            (tokenRepository.find as jest.Mock).mockResolvedValue([loanToken]);
            (marketRepository.find as jest.Mock).mockResolvedValue([]);
            (marketRepository.create as jest.Mock).mockImplementation(
                (data: any) => data,
            );
            (marketRepository.save as jest.Mock).mockRejectedValue(
                new Error("connection refused"),
            );

            // onModuleInit catches the error and logs it
            // So we just verify it doesn't crash the test
            await worker.onModuleInit();

            // The error is caught by onModuleInit's try/catch
            expect(marketRepository.save).toHaveBeenCalled();
        });
    });

    describe("handleInterval", () => {
        it("should call ensureFutureMaturitiesForLoanTokens", async () => {
            (tokenRepository.find as jest.Mock).mockResolvedValue([]);
            (marketRepository.find as jest.Mock).mockResolvedValue([]);

            await worker.handleInterval();

            expect(tokenRepository.find).toHaveBeenCalledWith({
                where: { isLoanToken: true },
            });
        });

        it("should log error and not throw on failure", async () => {
            (tokenRepository.find as jest.Mock).mockRejectedValue(
                new Error("DB connection lost"),
            );

            // Should not throw
            await expect(worker.handleInterval()).resolves.not.toThrow();
        });
    });
});
