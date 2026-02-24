import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { OrderSide, OrderStatus, OrderType } from "./constants/order.constants";
import { OrderRepository } from "./repositories/order.repository";
import { OrdersService } from "./orders.service";
import { Market } from "../market/entities/market.entity";

const INSERT_INTERVAL_MS = Number.parseInt("5000", 10);
const PARTIAL_FILL_INTERVAL_MS = Number.parseInt("7000", 10);
const MAX_OPEN_ORDERS = Number.parseInt("500", 10);
const CACHE_REFRESH_INTERVAL_MS = Number.parseInt("300000", 10);

const RATE_MIN = Number.parseInt("100", 10);
const RATE_MAX = Number.parseInt("2500", 10);
const QUANTITY_MIN = Number.parseFloat("0.0001");
const QUANTITY_MAX = Number.parseFloat("0.001");
const PARTIAL_FILL_MIN_FRACTION = Number.parseFloat("0.2");
const PARTIAL_FILL_MAX_FRACTION = Number.parseFloat("0.5");

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
    }> = [];

    constructor(
        private readonly orderRepository: OrderRepository,
        @InjectRepository(Market)
        private readonly marketRepository: Repository<Market>,
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

    @Interval(CACHE_REFRESH_INTERVAL_MS)
    async refreshAssetMarketCache(): Promise<void> {
        if (!this.isEnabled) return;

        try {
            const markets = await this.marketRepository.find();
            const grouped = new Map<string, string[]>();

            for (const m of markets) {
                const arr = grouped.get(m.assetId) ?? [];
                arr.push(m.id);
                grouped.set(m.assetId, arr);
            }
            this.assetMarketCache = Array.from(grouped.entries()).map(
                ([assetId, marketIds]) => ({ assetId, marketIds }),
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

    @Interval(INSERT_INTERVAL_MS)
    async createRandomOrder(): Promise<void> {
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

            const side = this.getRandomSide();
            const type = this.getRandomType();
            const amount = this.getRandomQuantity().toString();
            const rate = this.getRandomRate();
            const account =
                ACCOUNTS[Math.floor(Math.random() * ACCOUNTS.length)];

            if (side === OrderSide.Lend && type === OrderType.Market) {
                await this.ordersService.createLendMarketOrder(
                    { assetId, amount, marketIds },
                    account.wallet,
                    account.privyUserId,
                );
                return;
            }

            if (side === OrderSide.Lend && type === OrderType.Limit) {
                await this.ordersService.createLendLimitOrder(
                    { assetId, amount, marketIds, rate },
                    account.wallet,
                    account.privyUserId,
                );
                return;
            }

            if (side === OrderSide.Borrow && type === OrderType.Market) {
                await this.ordersService.createBorrowMarketOrder(
                    { assetId, amount, marketIds },
                    account.wallet,
                    account.privyUserId,
                );
                return;
            }

            if (side === OrderSide.Borrow && type === OrderType.Limit) {
                await this.ordersService.createBorrowLimitOrder(
                    { assetId, amount, marketIds, rate },
                    account.wallet,
                    account.privyUserId,
                );
                return;
            }
        } catch (error) {
            this.logger.error(
                `Failed to insert order: ${(error as Error).message}`,
            );
        }
    }

    @Interval(PARTIAL_FILL_INTERVAL_MS)
    async partiallyFillRandomOrder(): Promise<void> {
        if (!this.isEnabled) return;

        try {
            const order = await this.orderRepository
                .createQueryBuilder("order")
                .where("order.status IN (:...statuses)", {
                    statuses: [OrderStatus.Open, OrderStatus.PartiallyFilled],
                })
                .orderBy("RANDOM()")
                .getOne();

            if (!order) {
                return;
            }

            // DB numeric columns may return strings like "2.0"; strip decimal for BigInt
            const quantity = BigInt(order.quantity.split(".")[0]);
            const filledQuantity = BigInt(
                (order.filledQuantity ?? "0").split(".")[0],
            );
            const remaining = quantity - filledQuantity;
            if (remaining <= 0n) {
                return;
            }

            const remainingNum = Number(remaining);
            const incrementNum = Math.max(
                1,
                Math.round(
                    remainingNum *
                        (PARTIAL_FILL_MIN_FRACTION +
                            Math.random() *
                                (PARTIAL_FILL_MAX_FRACTION -
                                    PARTIAL_FILL_MIN_FRACTION)),
                ),
            );
            const increment = BigInt(incrementNum);

            const nextFilled =
                filledQuantity + increment >= quantity
                    ? quantity
                    : filledQuantity + increment;

            order.filledQuantity = nextFilled.toString();

            if (nextFilled >= quantity) {
                order.status = OrderStatus.Filled;
                order.filledSettlementFee = order.settlementFee.split(".")[0];
            } else {
                order.status = OrderStatus.PartiallyFilled;
                const feeTotal = BigInt(order.settlementFee.split(".")[0]);
                const filledFee = (feeTotal * nextFilled) / quantity;
                order.filledSettlementFee = filledFee.toString();
            }

            await this.orderRepository.save(order);
        } catch (error) {
            this.logger.error(
                `Failed to update order partial fill: ${(error as Error).message}`,
            );
        }
    }

    private getRandomSide(): OrderSide {
        return Math.random() < 0.5 ? OrderSide.Lend : OrderSide.Borrow;
    }

    private getRandomType(): OrderType {
        // Only generate limit orders so every order has a non-zero rate (APR)
        return OrderType.Limit;
    }

    private getRandomRate(): number {
        return Math.floor(Math.random() * (RATE_MAX - RATE_MIN + 1)) + RATE_MIN;
    }

    private getRandomQuantity(): string {
        const value =
            QUANTITY_MIN + Math.random() * (QUANTITY_MAX - QUANTITY_MIN);
        return value.toFixed(6);
    }
}
