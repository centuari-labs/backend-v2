import { Controller, Get, Query } from "@nestjs/common";
import { RateService } from "./rate-history.service";
import { RateHistoryQueryDto, RateHistoryDataDto } from "./dto/rate-history.dto";

//@todo : move this into market controller for market detail
@Controller("rate-history")
export class RateController {
    constructor(private readonly rateService: RateService) { }

    @Get()
    async getRateHistory(@Query() query: RateHistoryQueryDto): Promise<RateHistoryDataDto> {
        return this.rateService.getRateHistory(query.assetId);
    }
}