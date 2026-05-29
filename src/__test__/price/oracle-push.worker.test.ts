import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { OraclePushWorker } from "../../price/oracle-push.worker";
import { OraclePushService } from "../../price/oracle-push.service";

describe("OraclePushWorker", () => {
    let worker: OraclePushWorker;
    let service: jest.Mocked<Pick<OraclePushService, "pushAllPrices">>;
    let loggerSpies: jest.SpyInstance[];

    beforeAll(() => {
        loggerSpies = [
            jest.spyOn(Logger.prototype, "error").mockImplementation(() => {}),
            jest.spyOn(Logger.prototype, "debug").mockImplementation(() => {}),
        ];
    });

    afterAll(() => loggerSpies.forEach((s) => s.mockRestore()));

    beforeEach(async () => {
        const mockService = { pushAllPrices: jest.fn() };
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                OraclePushWorker,
                { provide: OraclePushService, useValue: mockService },
            ],
        }).compile();

        worker = module.get(OraclePushWorker);
        service = module.get(OraclePushService);
    });

    afterEach(() => jest.clearAllMocks());

    it("calls pushAllPrices once per tick", async () => {
        service.pushAllPrices.mockResolvedValue(undefined);
        await worker.handleInterval();
        expect(service.pushAllPrices).toHaveBeenCalledTimes(1);
    });

    it("does not throw when pushAllPrices rejects", async () => {
        service.pushAllPrices.mockRejectedValue(new Error("rpc down"));
        await expect(worker.handleInterval()).resolves.toBeUndefined();
    });
});
