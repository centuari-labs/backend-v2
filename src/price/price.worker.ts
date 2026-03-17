import { Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { PriceService } from "./price.service";

const FETCH_INTERVAL_MS = 60_000; // 60 seconds

@Injectable()
export class PriceWorker {
    private readonly logger = new Logger(PriceWorker.name);

    constructor(private readonly priceService: PriceService) {}

    @Interval(FETCH_INTERVAL_MS)
    async handleInterval(): Promise<void> {
        this.logger.debug("Running scheduled price fetch");
        try {
            await this.priceService.fetchAndUpdatePrices();
        } catch (error) {
            this.logger.error(
                `Scheduled price fetch failed: ${(error as Error).message}`,
            );
        }
    }
}
