import { Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { OraclePushService } from "./oracle-push.service";

// Re-push well inside the on-chain maxStaleness window (86400s / 24h) so the
// OracleRouter never fail-closes between cycles. Tune down for fresher prices.
const ORACLE_PUSH_INTERVAL_MS = 600_000; // 10 minutes

@Injectable()
export class OraclePushWorker {
    private readonly logger = new Logger(OraclePushWorker.name);

    constructor(private readonly oraclePushService: OraclePushService) {}

    @Interval(ORACLE_PUSH_INTERVAL_MS)
    async handleInterval(): Promise<void> {
        this.logger.debug("Running scheduled oracle price push");
        try {
            await this.oraclePushService.pushAllPrices();
        } catch (error) {
            this.logger.error(
                `Scheduled oracle push failed: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        }
    }
}
