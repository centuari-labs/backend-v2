import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { InjectRepository } from "@nestjs/typeorm";
import { randomUUID } from "crypto";
import { Repository } from "typeorm";
import { Market } from "./entities/market.entity";
import { Token } from "../tokens/entities/token.entity";
import { getAllowedMaturitiesUtcSeconds } from "../orders/utils/maturity.utils";

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
        this.logger.debug("Running initial market maturities refresh on startup");

        try {
            const createdCount = await this.ensureFutureMaturitiesForLoanTokens();
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
            const createdCount = await this.ensureFutureMaturitiesForLoanTokens();
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
            this.logger.debug("No loan tokens found, skipping market maturities refresh");
            return 0;
        }

        const allowedMaturitiesSeconds = getAllowedMaturitiesUtcSeconds();
        const allowedMaturitiesDates = allowedMaturitiesSeconds.map(
            (seconds) => new Date(seconds * 1000),
        );

        let createdCount = 0;

        for (const token of loanTokens) {
            for (const maturity of allowedMaturitiesDates) {
                // Check if a market already exists for this asset and maturity
                const existing = await this.marketRepository.findOne({
                    where: {
                        assetId: token.id,
                        maturity,
                    },
                });

                if (existing) {
                    continue;
                }

                const market = this.marketRepository.create({
                    id: randomUUID(),
                    assetId: token.id,
                    maturity,
                });

                await this.marketRepository.save(market);
                createdCount += 1;
            }
        }

        return createdCount;
    }
}

