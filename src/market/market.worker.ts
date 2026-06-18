import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Interval } from "@nestjs/schedule";
import { Repository } from "typeorm";
import { Token } from "../tokens/entities/token.entity";
import { MarketRepositories } from "./repository/market.repository";

const MARKET_MATURITIES_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
const ONE_DAY_SECONDS = 24 * 60 * 60;
const ONE_MONTH_SECONDS = 30 * ONE_DAY_SECONDS;

/**
 * MarketWorker — daily cron that auto-ensures future maturities exist in
 * the shared `market` (BYTEA) registry for every known loan token. Without
 * this, the bot orderbook would starve on new tenors until an operator
 * manually called `POST /market/register`.
 *
 * Post-C4: this writes to the new `market` table via
 * `MarketRepositories.ensureMarketsForLoanToken` (BYTEA-keyed; mirrors the
 * C3 "backend writes first, indexer tail-writes with stamps" pattern). The
 * `applied_by_*` stamps stay NULL until the first `Centuari.MarketCreated`
 * event fires, after which the indexer's `ON CONFLICT (market_id) DO
 * NOTHING` clause makes the tail-write a safe no-op.
 *
 * The set of target maturities is computed dynamically (1, 3, 6, 12 months
 * out from now). Operator can still drive ad-hoc registrations via the
 * `POST /market/register` admin endpoint.
 */
@Injectable()
export class MarketWorker implements OnApplicationBootstrap {
    private readonly logger = new Logger(MarketWorker.name);

    constructor(
        @InjectRepository(Token)
        private readonly tokenRepository: Repository<Token>,
        private readonly marketRepository: MarketRepositories,
    ) {}

    /**
     * The eager first refresh runs in `onApplicationBootstrap`, not
     * `onModuleInit`. NestJS guarantees every module's `onModuleInit` has
     * completed before any `onApplicationBootstrap` fires, so by this point
     * `DatabaseService` has created its connection pool. Running the refresh
     * in `onModuleInit` raced that initialization — the worker's first call
     * could hit `getPool()` while the pool was still `undefined`, throwing
     * "Cannot read properties of undefined (reading 'connect')" on boot and
     * leaving markets uncreated until the next 24h interval (bug cc8af16).
     */
    async onApplicationBootstrap(): Promise<void> {
        try {
            await this.ensureFutureMaturitiesForLoanTokens();
        } catch (error) {
            this.logger.error(
                `Initial market maturities refresh failed: ${(error as Error).message}`,
            );
        }
    }

    @Interval(MARKET_MATURITIES_REFRESH_INTERVAL_MS)
    async ensureFutureMaturitiesForLoanTokens(): Promise<void> {
        try {
            const loanTokens = await this.tokenRepository.find({
                where: { isLoanToken: true },
            });

            const targetMaturities = this.computeTargetMaturities();

            for (const token of loanTokens) {
                const registered =
                    await this.marketRepository.ensureMarketsForLoanToken(
                        token.tokenAddress,
                        targetMaturities,
                    );
                this.logger.debug(
                    `ensured ${registered.length} maturities for ${token.symbol} (${token.tokenAddress})`,
                );
            }

            this.logger.log(
                `Market maturities refreshed for ${loanTokens.length} loan tokens`,
            );
        } catch (error) {
            this.logger.error(
                `Scheduled market maturities refresh failed: ${(error as Error).message}`,
            );
        }
    }

    /**
     * Rolling set of target maturities anchored to `now`. The 1/3/6/12-month
     * pattern matches what the bot orderbook needs to quote across the full
     * tenor curve at any given time.
     */
    private computeTargetMaturities(): number[] {
        const nowUnix = Math.floor(Date.now() / 1000);
        return [
            nowUnix + ONE_MONTH_SECONDS,
            nowUnix + 3 * ONE_MONTH_SECONDS,
            nowUnix + 6 * ONE_MONTH_SECONDS,
            nowUnix + 12 * ONE_MONTH_SECONDS,
        ];
    }
}
