import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Market } from "./entities/market.entity";
import { Token } from "../tokens/entities/token.entity";
import { getAllowedMaturitiesUtcSeconds } from "../orders/utils/maturity.utils";
import { computeMarketId } from "./utils/market-id.utils";

const MARKET_MATURITIES_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000; // once per day
@Injectable()
export class MarketWorker implements OnModuleInit {
    private readonly logger = new Logger(MarketWorker.name);

    constructor(
        @InjectRepository(Market)
        private readonly marketRepository: Repository<Market>,
        @InjectRepository(Token)
        private readonly tokenRepository: Repository<Token>,
    ) {}

    async onModuleInit(): Promise<void> {
        this.logger.debug(
            "Running initial market maturities refresh on startup",
        );

        try {
            const createdCount =
                await this.ensureFutureMaturitiesForLoanTokens();
            this.logger.debug(
                `Initial market maturities refresh completed, created ${createdCount} new market(s)`,
            );
        } catch (error) {
            this.logger.error(
                `Initial market maturities refresh failed: ${(error as Error).message}`,
            );
        }
    }

    @Interval(MARKET_MATURITIES_REFRESH_INTERVAL_MS)
    async handleInterval(): Promise<void> {
        this.logger.debug("Running scheduled market maturities refresh");

        try {
            const createdCount =
                await this.ensureFutureMaturitiesForLoanTokens();
            this.logger.debug(
                `Scheduled market maturities refresh completed, created ${createdCount} new market(s)`,
            );
        } catch (error) {
            this.logger.error(
                `Scheduled market maturities refresh failed: ${(error as Error).message}`,
            );
        }
    }

    private async ensureFutureMaturitiesForLoanTokens(): Promise<number> {
        const loanTokens = await this.tokenRepository.find({
            where: { isLoanToken: true },
        });

        if (loanTokens.length === 0) {
            this.logger.debug(
                "No loan tokens found, skipping market maturities refresh",
            );
            return 0;
        }

        const allowedMaturitiesSeconds = getAllowedMaturitiesUtcSeconds();
        const allowedMaturitiesDates = allowedMaturitiesSeconds.map(
            (seconds) => new Date(seconds * 1000),
        );

        // Batch-fetch all existing markets to avoid N+1 queries
        const existingMarkets = await this.marketRepository.find({
            select: ["assetId", "maturity"],
        });

        const existingKeys = new Set(
            existingMarkets.map((m) => `${m.assetId}_${m.maturity.getTime()}`),
        );

        let createdCount = 0;

        for (const token of loanTokens) {
            for (const maturity of allowedMaturitiesDates) {
                const key = `${token.id}_${maturity.getTime()}`;

                if (existingKeys.has(key)) {
                    continue;
                }

                try {
                    const maturityUnixSeconds = Math.floor(
                        maturity.getTime() / 1000,
                    );
                    const market = this.marketRepository.create({
                        id: computeMarketId(
                            token.tokenAddress,
                            maturityUnixSeconds,
                        ),
                        assetId: token.id,
                        maturity,
                    });

                    await this.marketRepository.save(market);
                    createdCount += 1;
                } catch (error) {
                    // Handle race condition: another process may have
                    // inserted the same (assetId, maturity) between
                    // our check and insert
                    if (
                        (error as Error).message?.includes("duplicate key") ||
                        (error as Error).message?.includes("unique constraint")
                    ) {
                        this.logger.debug(
                            `Market already exists for asset ${token.id} maturity ${maturity.toISOString()}, skipping`,
                        );
                        continue;
                    }
                    throw error;
                }
            }
        }

        return createdCount;
    }
}
