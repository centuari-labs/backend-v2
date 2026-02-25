import { Injectable } from "@nestjs/common";
import { RateRepository } from "./repositories/rate-history.respository";
import { RateHistoryDataDto } from "./dto/rate-history.dto";

@Injectable()
export class RateService {
    constructor(private readonly rateRepository: RateRepository) { }

    async getRateHistory(assetId: string): Promise<RateHistoryDataDto> {
        const rateHistory = await this.rateRepository.getRateHistoryByAssetId(assetId);

        return {
            assetId,
            rateHistory,
        };
    }
}