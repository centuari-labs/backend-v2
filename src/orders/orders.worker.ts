import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { OrderRepository } from "./repositories/order.repository";
import { OrdersService } from "./orders.service";
import { Market } from "../market/entities/market.entity";
import { Token } from "../tokens/entities/token.entity";

const LEND_INSERT_INTERVAL_MS = 15000;
const BORROW_INSERT_INTERVAL_MS = 15000;
const CACHE_REFRESH_INTERVAL_MS = 60000;

const LEND_RATE_MIN = 600;
const LEND_RATE_MAX = 1500;
const BORROW_RATE_MIN = 200;
const BORROW_RATE_MAX = 800;
const LEND_QUANTITY_MIN = 500;
const LEND_QUANTITY_MAX = 10000;
const BORROW_QUANTITY_MIN = 100;
const BORROW_QUANTITY_MAX = 5000;
const MARKET_ORDER_PROBABILITY = 0.05;

const ACCOUNTS = [
    {
        wallet: "0xcA2E021f8FEA9E3fb5F86A68A3158315404e6157",
        privyUserId: "did:privy:clx8f2a7k000001",
    },
    {
        wallet: "0xAb9A004468A39cCC07e1f62B59F990f45304a222",
        privyUserId: "did:privy:clx8f2a7k000002",
    },
    {
        wallet: "0x43765641b3632f45366cD91D9F128CFeb34b218F",
        privyUserId: "did:privy:clx8f2a7k000003",
    },
    {
        wallet: "0x103D2146DE8E682ca21eb2fbF9CF9a3e8a127749",
        privyUserId: "did:privy:clx8f2a7k000004",
    },
    {
        wallet: "0xCeCe52a44e9e6E57051791E7472CA87b3D789c3e",
        privyUserId: "did:privy:clx8f2a7k000005",
    },
    {
        wallet: "0xd0c75db43eBa0512D84e6f77104646809f1cac99",
        privyUserId: "did:privy:clx8f2a7k000006",
    },
];

@Injectable()
export class OrdersWorker implements OnModuleInit {
    private readonly logger = new Logger(OrdersWorker.name);
    private assetMarketCache: Array<{
        assetId: string;
        symbol: string;
        marketIds: string[];
    }> = [];

    constructor(
        private readonly orderRepository: OrderRepository,
        @InjectRepository(Market)
        private readonly marketRepository: Repository<Market>,
        @InjectRepository(Token)
        private readonly tokenRepository: Repository<Token>,
        private readonly ordersService: OrdersService,
    ) {}

    async onModuleInit(): Promise<void> {
        if (!this.isEnabled) {
            this.logger.log(
                "OrdersWorker is disabled (NODE_ENV or ORDER_WORKER_ENABLED).",
            );
            return;
        }
        this.logger.log("OrdersWorker enabled — loading asset/market cache.");
        await this.refreshAssetMarketCache();
    }

    private get isEnabled(): boolean {
        if (process.env.NODE_ENV === "production") return false;
        return process.env.ORDER_WORKER_ENABLED === "true";
    }

    // ─── Cache ───────────────────────────────────────────────────────────

    @Interval(CACHE_REFRESH_INTERVAL_MS)
    async refreshAssetMarketCache(): Promise<void> {
        if (!this.isEnabled) return;

        try {
            const markets = await this.marketRepository.find();
            const tokens = await this.tokenRepository.find();
            const tokenSymbolMap = new Map<string, string>();
            for (const t of tokens) {
                tokenSymbolMap.set(t.id, t.symbol);
            }

            const grouped = new Map<string, string[]>();
            for (const m of markets) {
                const arr = grouped.get(m.assetId) ?? [];
                arr.push(m.id);
                grouped.set(m.assetId, arr);
            }
            this.assetMarketCache = Array.from(grouped.entries()).map(
                ([assetId, marketIds]) => ({
                    assetId,
                    symbol: tokenSymbolMap.get(assetId) ?? "UNKNOWN",
                    marketIds,
                }),
            );
            this.logger.debug(
                `Asset/market cache refreshed: ${this.assetMarketCache.map((e) => e.symbol).join(", ")}`,
            );
        } catch (error) {
            this.logger.error(
                `Failed to refresh asset/market cache: ${(error as Error).message}`,
            );
        }
    }

    // ─── Create LEND orders (one per loan token per interval) ─────────

    @Interval(LEND_INSERT_INTERVAL_MS)
    async createLendOrders(): Promise<void> {
        if (!this.isEnabled || this.assetMarketCache.length === 0) return;

        for (const entry of this.assetMarketCache) {
            try {
                const { assetId, marketIds, symbol } = entry;
                const amount = this.randomQuantity(LEND_QUANTITY_MIN, LEND_QUANTITY_MAX);
                const account = this.randomAccount();

                if (Math.random() < MARKET_ORDER_PROBABILITY) {
                    await this.ordersService.createLendMarketOrder(
                        { assetId, amount, marketIds },
                        account.wallet,
                        account.privyUserId,
                    );
                    this.logger.debug(`[LEND MARKET] ${symbol} amount=${amount}`);
                } else {
                    const rate = this.randomRate(LEND_RATE_MIN, LEND_RATE_MAX);
                    await this.ordersService.createLendLimitOrder(
                        { assetId, amount, marketIds, rate },
                        account.wallet,
                        account.privyUserId,
                    );
                    this.logger.debug(`[LEND LIMIT] ${symbol} amount=${amount} rate=${rate}bp`);
                }
            } catch (error) {
                this.logger.error(
                    `Failed to insert lend order for ${entry.symbol}: ${(error as Error).message}`,
                );
            }
        }
    }

    // ─── Create BORROW orders (one per loan token per interval) ───────

    @Interval(BORROW_INSERT_INTERVAL_MS)
    async createBorrowOrders(): Promise<void> {
        if (!this.isEnabled || this.assetMarketCache.length === 0) return;

        for (const entry of this.assetMarketCache) {
            try {
                const { assetId, marketIds, symbol } = entry;
                const amount = this.randomQuantity(BORROW_QUANTITY_MIN, BORROW_QUANTITY_MAX);
                const account = this.randomAccount();

                if (Math.random() < MARKET_ORDER_PROBABILITY) {
                    await this.ordersService.createBorrowMarketOrder(
                        { assetId, amount, marketIds },
                        account.wallet,
                        account.privyUserId,
                    );
                    this.logger.debug(`[BORROW MARKET] ${symbol} amount=${amount}`);
                } else {
                    const rate = this.randomRate(BORROW_RATE_MIN, BORROW_RATE_MAX);
                    await this.ordersService.createBorrowLimitOrder(
                        { assetId, amount, marketIds, rate },
                        account.wallet,
                        account.privyUserId,
                    );
                    this.logger.debug(`[BORROW LIMIT] ${symbol} amount=${amount} rate=${rate}bp`);
                }
            } catch (error) {
                this.logger.error(
                    `Failed to insert borrow order for ${entry.symbol}: ${(error as Error).message}`,
                );
            }
        }
    }

    // ─── Helpers ─────────────────────────────────────────────────────────

    private randomRate(min: number, max: number): number {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    private randomQuantity(min: number, max: number): string {
        return (min + Math.random() * (max - min)).toFixed(2);
    }

    private randomAccount() {
        return ACCOUNTS[Math.floor(Math.random() * ACCOUNTS.length)];
    }
}
