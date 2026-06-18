import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { PriceWorker } from "../../price/price.worker";
import { PriceService } from "../../price/price.service";

describe("PriceWorker", () => {
    let worker: PriceWorker;
    let priceService: jest.Mocked<Pick<PriceService, "fetchAndUpdatePrices">>;
    let loggerErrorSpy: jest.SpyInstance;
    let loggerDebugSpy: jest.SpyInstance;

    beforeAll(() => {
        loggerErrorSpy = jest
            .spyOn(Logger.prototype, "error")
            .mockImplementation(() => {});
        loggerDebugSpy = jest
            .spyOn(Logger.prototype, "debug")
            .mockImplementation(() => {});
    });

    afterAll(() => {
        loggerErrorSpy.mockRestore();
        loggerDebugSpy.mockRestore();
    });

    beforeEach(async () => {
        const mockPriceService = {
            fetchAndUpdatePrices: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PriceWorker,
                { provide: PriceService, useValue: mockPriceService },
            ],
        }).compile();

        worker = module.get(PriceWorker);
        priceService = module.get(PriceService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("handleInterval", () => {
        it("should call priceService.fetchAndUpdatePrices once", async () => {
            priceService.fetchAndUpdatePrices.mockResolvedValue(undefined);

            await worker.handleInterval();

            expect(priceService.fetchAndUpdatePrices).toHaveBeenCalledTimes(1);
        });

        it("should not throw when fetchAndUpdatePrices rejects", async () => {
            priceService.fetchAndUpdatePrices.mockRejectedValue(
                new Error("Provider error"),
            );

            await expect(worker.handleInterval()).resolves.toBeUndefined();
        });
    });
});
