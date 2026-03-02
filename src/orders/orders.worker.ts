import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { OrderStatus } from "./constants/order.constants";
import { OrderRepository } from "./repositories/order.repository";
import { OrdersService } from "./orders.service";
import { Market } from "../market/entities/market.entity";
import { Token } from "../tokens/entities/token.entity";

const LEND_INSERT_INTERVAL_MS = Number.parseInt("3000", 10);
const BORROW_INSERT_INTERVAL_MS = Number.parseInt("3000", 10);
const MAX_OPEN_ORDERS = Number.parseInt("10000", 10);
const CACHE_REFRESH_INTERVAL_MS = Number.parseInt("60000", 10);

const LEND_RATE_MIN = Number.parseInt("300", 10);
const LEND_RATE_MAX = Number.parseInt("1200", 10);
const BORROW_RATE_MIN = Number.parseInt("500", 10);
const BORROW_RATE_MAX = Number.parseInt("1500", 10);
const LEND_QUANTITY_MIN = Number.parseFloat("500");
const LEND_QUANTITY_MAX = Number.parseFloat("10000");
const BORROW_QUANTITY_MIN = Number.parseFloat("100");
const BORROW_QUANTITY_MAX = Number.parseFloat("5000");
const MARKET_ORDER_PROBABILITY = 0.3;

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
        marketIds: string[];
        tokenAddress: string;
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
            const tokenAddressMap = new Map<string, string>();
            for (const t of tokens) {
                tokenAddressMap.set(t.id, t.tokenAddress);
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
                    marketIds,
                    tokenAddress: tokenAddressMap.get(assetId) ?? "",
                }),
            );
            this.logger.debug(
                `Asset/market cache refreshed: ${this.assetMarketCache.length} assets with markets.`,
            );
        } catch (error) {
            this.logger.error(
                `Failed to refresh asset/market cache: ${(error as Error).message}`,
            );
        }
    }

    // ─── 1a. Create LEND orders ──────────────────────────────────────────

    @Interval(LEND_INSERT_INTERVAL_MS)
    async createLendOrder(): Promise<void> {
        if (!this.isEnabled) return;

        try {
            if (this.assetMarketCache.length === 0) {
                this.logger.warn(
                    "Asset/market cache is empty. Skipping order creation.",
                );
                return;
            }

            const openCount = await this.orderRepository.count({
                where: { status: OrderStatus.Open },
            });

            if (openCount >= MAX_OPEN_ORDERS) {
                return;
            }

            const entry =
                this.assetMarketCache[
                    Math.floor(Math.random() * this.assetMarketCache.length)
                ];

            const { assetId, marketIds } = entry;
            const amount = this.getRandomLendQuantity();
            const account =
                ACCOUNTS[Math.floor(Math.random() * ACCOUNTS.length)];

            if (Math.random() < MARKET_ORDER_PROBABILITY) {
                await this.ordersService.createLendMarketOrder(
                    { assetId, amount, marketIds },
                    account.wallet,
                    account.privyUserId,
                );
            } else {
                const rate = this.getRandomLendRate();
                await this.ordersService.createLendLimitOrder(
                    { assetId, amount, marketIds, rate },
                    account.wallet,
                    account.privyUserId,
                );
            }
        } catch (error) {
            this.logger.error(
                `Failed to insert lend order: ${(error as Error).message}`,
            );
        }
    }

    // ─── 1b. Create BORROW orders ────────────────────────────────────────

    @Interval(BORROW_INSERT_INTERVAL_MS)
    async createBorrowOrder(): Promise<void> {
        if (!this.isEnabled) return;

        try {
            if (this.assetMarketCache.length === 0) {
                this.logger.warn(
                    "Asset/market cache is empty. Skipping order creation.",
                );
                return;
            }

            const openCount = await this.orderRepository.count({
                where: { status: OrderStatus.Open },
            });

            if (openCount >= MAX_OPEN_ORDERS) {
                return;
            }

            const entry =
                this.assetMarketCache[
                    Math.floor(Math.random() * this.assetMarketCache.length)
                ];

            const { assetId, marketIds } = entry;
            const amount = this.getRandomBorrowQuantity();
            const account =
                ACCOUNTS[Math.floor(Math.random() * ACCOUNTS.length)];

            if (Math.random() < MARKET_ORDER_PROBABILITY) {
                await this.ordersService.createBorrowMarketOrder(
                    { assetId, amount, marketIds },
                    account.wallet,
                    account.privyUserId,
                );
            } else {
                const rate = this.getRandomBorrowRate();
                await this.ordersService.createBorrowLimitOrder(
                    { assetId, amount, marketIds, rate },
                    account.wallet,
                    account.privyUserId,
                );
            }
        } catch (error) {
            this.logger.error(
                `Failed to insert borrow order: ${(error as Error).message}`,
            );
        }
    }

    // ─── Helpers ─────────────────────────────────────────────────────────

    private getRandomLendRate(): number {
        return (
            Math.floor(Math.random() * (LEND_RATE_MAX - LEND_RATE_MIN + 1)) +
            LEND_RATE_MIN
        );
    }

    private getRandomBorrowRate(): number {
        return (
            Math.floor(
                Math.random() * (BORROW_RATE_MAX - BORROW_RATE_MIN + 1),
            ) + BORROW_RATE_MIN
        );
    }

    private getRandomLendQuantity(): string {
        const value =
            LEND_QUANTITY_MIN +
            Math.random() * (LEND_QUANTITY_MAX - LEND_QUANTITY_MIN);
        return value.toFixed(2);
    }

    private getRandomBorrowQuantity(): string {
        const value =
            BORROW_QUANTITY_MIN +
            Math.random() * (BORROW_QUANTITY_MAX - BORROW_QUANTITY_MIN);
        return value.toFixed(2);
    }
}
