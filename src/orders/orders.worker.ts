import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import {
    OrderSide,
    OrderStatus,
    OrderType,
} from "./constants/order.constants";
import { Order } from "./entities/order.entity";
import { OrderRepository } from "./repositories/order.repository";
import { OrdersService } from "./orders.service";
import { Market } from "../market/entities/market.entity";

const INSERT_INTERVAL_MS = Number.parseInt("5000", 10);
const PARTIAL_FILL_INTERVAL_MS = Number.parseInt("8000", 10);
const FILL_INTERVAL_MS = Number.parseInt("15000", 10);
const MAX_OPEN_ORDERS = Number.parseInt("50", 10);
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
        private readonly dataSource: DataSource,
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

    // ─── 1. Create OPEN orders ───────────────────────────────────────────

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
            const amount = this.getRandomQuantity();
            const rate = this.getRandomRate();
            const account =
                ACCOUNTS[Math.floor(Math.random() * ACCOUNTS.length)];

            if (side === OrderSide.Lend) {
                await this.ordersService.createLendLimitOrder(
                    { assetId, amount, marketIds, rate },
                    account.wallet,
                    account.privyUserId,
                );
            } else {
                await this.ordersService.createBorrowLimitOrder(
                    { assetId, amount, marketIds, rate },
                    account.wallet,
                    account.privyUserId,
                );
            }
        } catch (error) {
            this.logger.error(
                `Failed to insert order: ${(error as Error).message}`,
            );
        }
    }

    // ─── 2. Partially fill OPEN → PARTIALLY_FILLED ──────────────────────

    @Interval(PARTIAL_FILL_INTERVAL_MS)
    async partiallyFillRandomOrder(): Promise<void> {
        if (!this.isEnabled) return;

        try {
            const order = await this.orderRepository
                .createQueryBuilder("order")
                .where("order.status = :status", {
                    status: OrderStatus.Open,
                })
                .orderBy("RANDOM()")
                .getOne();

            if (!order) return;

            const quantity = BigInt(order.quantity.split(".")[0]);
            const filledQuantity = BigInt(
                (order.filledQuantity ?? "0").split(".")[0],
            );
            const remaining = quantity - filledQuantity;
            if (remaining <= 0n) return;

            const remainingNum = Number(remaining);
            const fraction =
                PARTIAL_FILL_MIN_FRACTION +
                Math.random() *
                    (PARTIAL_FILL_MAX_FRACTION - PARTIAL_FILL_MIN_FRACTION);
            const incrementNum = Math.max(1, Math.round(remainingNum * fraction));
            const increment = BigInt(incrementNum);

            // Ensure it stays partially filled (don't fill 100%)
            const nextFilled = filledQuantity + increment;
            if (nextFilled >= quantity) return; // skip — let fillRandomOrder handle full fills

            order.filledQuantity = nextFilled.toString();
            order.status = OrderStatus.PartiallyFilled;

            const feeTotal = BigInt(order.settlementFee.split(".")[0]);
            const filledFee =
                quantity > 0n ? (feeTotal * nextFilled) / quantity : 0n;
            order.filledSettlementFee = filledFee.toString();

            await this.orderRepository.save(order);
            this.logger.debug(
                `Partially filled order ${order.id}: ${nextFilled}/${quantity}`,
            );
        } catch (error) {
            this.logger.error(
                `Failed to partially fill order: ${(error as Error).message}`,
            );
        }
    }

    // ─── 3. Fully fill → FILLED + match + positions ─────────────────────

    @Interval(FILL_INTERVAL_MS)
    async fillRandomOrder(): Promise<void> {
        if (!this.isEnabled) return;

        try {
            // Prefer partially filled orders, fall back to open
            let order = await this.orderRepository
                .createQueryBuilder("order")
                .where("order.status = :status", {
                    status: OrderStatus.PartiallyFilled,
                })
                .orderBy("RANDOM()")
                .getOne();

            if (!order) {
                order = await this.orderRepository
                    .createQueryBuilder("order")
                    .where("order.status = :status", {
                        status: OrderStatus.Open,
                    })
                    .orderBy("RANDOM()")
                    .getOne();
            }

            if (!order) return;

            const quantity = BigInt(order.quantity.split(".")[0]);
            if (quantity <= 0n) return;

            // Pick a counterparty account
            const counterparty =
                ACCOUNTS[Math.floor(Math.random() * ACCOUNTS.length)];

            // Resolve a market for this asset
            const entry = this.assetMarketCache.find(
                (e) => e.assetId === order!.assetId,
            );
            if (!entry || entry.marketIds.length === 0) return;
            const marketId =
                entry.marketIds[
                    Math.floor(Math.random() * entry.marketIds.length)
                ];

            // Find order_market row (needed for match FK)
            const orderMarket = await this.dataSource
                .createQueryBuilder()
                .select("om.order_market_id", "order_market_id")
                .from("order_markets", "om")
                .where("om.order_id = :orderId", { orderId: order.id })
                .getRawOne();

            if (!orderMarket) {
                this.logger.debug(
                    `No order_market for order ${order.id}, skipping fill.`,
                );
                return;
            }

            // Get market maturity
            const market = await this.marketRepository.findOne({
                where: { id: marketId },
            });
            const maturity =
                market?.maturity ?? new Date(Date.now() + 30 * 86400000);

            // Ensure counterparty account exists
            const counterpartyAccount =
                await this.orderRepository.getOrCreateAccount(
                    counterparty.wallet,
                    counterparty.privyUserId,
                );

            const isLend = order.side === OrderSide.Lend;
            const counterpartySide = isLend
                ? OrderSide.Borrow
                : OrderSide.Lend;

            await this.dataSource.transaction(async (manager) => {
                // 1. Mark original order as FILLED
                await manager
                    .getRepository(Order)
                    .update(order!.id, {
                        filledQuantity: quantity.toString(),
                        status: OrderStatus.Filled,
                        filledSettlementFee:
                            order!.settlementFee.split(".")[0],
                    });

                // 2. Create counterparty order (FILLED immediately)
                const counterpartyOrderResult = await manager
                    .createQueryBuilder()
                    .insert()
                    .into("orders")
                    .values({
                        account_id: counterpartyAccount.id,
                        asset_id: order!.assetId,
                        side: counterpartySide,
                        type: OrderType.Limit,
                        rate: order!.rate,
                        quantity: quantity.toString(),
                        filled_quantity: quantity.toString(),
                        settlement_fee: "0",
                        filled_settlement_fee: "0",
                        status: OrderStatus.Filled,
                    })
                    .returning("id")
                    .execute();

                const counterpartyOrderId =
                    counterpartyOrderResult.generatedMaps[0]?.id ??
                    counterpartyOrderResult.raw[0]?.id;

                // 3. Create order_market for counterparty
                await manager
                    .createQueryBuilder()
                    .insert()
                    .into("order_markets")
                    .values({
                        order_id: counterpartyOrderId,
                        market_id: marketId,
                    })
                    .execute();

                // 4. Create match record
                const lendOrderId = isLend ? order!.id : counterpartyOrderId;
                const borrowOrderId = isLend ? counterpartyOrderId : order!.id;
                const lenderAccountId = isLend
                    ? order!.accountId
                    : counterpartyAccount.id;
                const borrowerAccountId = isLend
                    ? counterpartyAccount.id
                    : order!.accountId;

                await manager
                    .createQueryBuilder()
                    .insert()
                    .into("matches")
                    .values({
                        lend_order_market_id: lendOrderId,
                        borrow_order_market_id: borrowOrderId,
                        asset_id: order!.assetId,
                        lender_account_id: lenderAccountId,
                        borrower_account_id: borrowerAccountId,
                        match_amount: quantity.toString(),
                        rate: order!.rate,
                        is_borrower_taker: !isLend,
                        maker_fee: 0,
                        taker_fee: 0,
                        lender_settlement_fee: 0,
                        borrower_settlement_fee: 0,
                        maturity,
                    })
                    .execute();

                // 5. Create lend position
                await manager
                    .createQueryBuilder()
                    .insert()
                    .into("lend_positions")
                    .values({
                        account_id: lenderAccountId,
                        asset_id: order!.assetId,
                        market_id: marketId,
                        shares: quantity.toString(),
                        original_shares: quantity.toString(),
                        amount: quantity.toString(),
                    })
                    .execute();

                // 6. Create borrow position
                await manager
                    .createQueryBuilder()
                    .insert()
                    .into("borrow_positions")
                    .values({
                        account_id: borrowerAccountId,
                        asset_id: order!.assetId,
                        market_id: marketId,
                        amount: quantity.toString(),
                        original_debt: quantity.toString(),
                        debt: quantity.toString(),
                    })
                    .execute();
            });

            this.logger.log(
                `Filled order ${order.id} (${order.side} ${quantity} of asset ${order.assetId})`,
            );
        } catch (error) {
            this.logger.error(
                `Failed to fill order: ${(error as Error).message}`,
            );
        }
    }

    // ─── Helpers ─────────────────────────────────────────────────────────

    private getRandomSide(): OrderSide {
        return Math.random() < 0.5 ? OrderSide.Lend : OrderSide.Borrow;
    }

    private getRandomRate(): number {
        return (
            Math.floor(Math.random() * (RATE_MAX - RATE_MIN + 1)) + RATE_MIN
        );
    }

    private getRandomQuantity(): string {
        const value =
            QUANTITY_MIN + Math.random() * (QUANTITY_MAX - QUANTITY_MIN);
        return value.toFixed(6);
    }
}
