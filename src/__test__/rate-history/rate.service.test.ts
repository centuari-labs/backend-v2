import { Test, TestingModule } from "@nestjs/testing";
import { RateService } from "../../rate-history/rate-history.service";
import { RateRepository } from "../../rate-history/repositories/rate-history.respository";

describe("RateService", () => {
    let service: RateService;
    let rateRepository: jest.Mocked<RateRepository>;

    beforeEach(async () => {
        const mockRateRepository: jest.Mocked<Partial<RateRepository>> = {
            getRateHistoryByAssetId: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                RateService,
                { provide: RateRepository, useValue: mockRateRepository },
            ],
        }).compile();

        service = module.get(RateService);
        rateRepository = module.get(RateRepository);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("getRateHistory", () => {
        const assetId = "550e8400-e29b-41d4-a716-446655440000";

        it("should return rate history with correct response shape", async () => {
            const mockData = [
                { date: "2026-02-20", rate: 3.5 },
                { date: "2026-02-21", rate: 3.2 },
                { date: "2026-02-22", rate: 3.8 },
            ];
            rateRepository.getRateHistoryByAssetId.mockResolvedValue(mockData);

            const result = await service.getRateHistory(assetId);

            expect(result).toEqual({
                assetId,
                rateHistory: mockData,
            });
            expect(rateRepository.getRateHistoryByAssetId).toHaveBeenCalledWith(assetId);
        });

        it("should return empty rate-history array when no data exists", async () => {
            rateRepository.getRateHistoryByAssetId.mockResolvedValue([]);

            const result = await service.getRateHistory(assetId);

            expect(result).toEqual({
                assetId,
                rateHistory: [],
            });
        });

        it("should not include extra fields in response", async () => {
            rateRepository.getRateHistoryByAssetId.mockResolvedValue([]);

            const result = await service.getRateHistory(assetId);

            expect(Object.keys(result)).toEqual(["assetId", "rateHistory"]);
        });
    });
});

