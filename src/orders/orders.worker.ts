import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { OrderSide, OrderStatus, OrderType } from "./constants/order.constants";
import { Order } from "./entities/order.entity";
import { OrderRepository } from "./repositories/order.repository";
import { OrdersService } from "./orders.service";
import { Market } from "../market/entities/market.entity";
import { Token } from "../tokens/entities/token.entity";
import { NatsService } from "../core/nats/nats.service";
import { EventsGateway } from "../core/websocket/websocket.gateway";

const LEND_INSERT_INTERVAL_MS = Number.parseInt("3000", 10);
const BORROW_INSERT_INTERVAL_MS = Number.parseInt("3000", 10);
const PARTIAL_FILL_INTERVAL_MS = Number.parseInt("600000", 10);
const FILL_INTERVAL_MS = Number.parseInt("1200000", 10);
const MAX_OPEN_ORDERS = Number.parseInt("10000", 10);
const CACHE_REFRESH_INTERVAL_MS = Number.parseInt("60000", 10);

const LEND_RATE_MIN = Number.parseInt("800", 10);
const LEND_RATE_MAX = Number.parseInt("2500", 10);
const BORROW_RATE_MIN = Number.parseInt("100", 10);
const BORROW_RATE_MAX = Number.parseInt("600", 10);
const LEND_QUANTITY_MIN = Number.parseFloat("500");
const LEND_QUANTITY_MAX = Number.parseFloat("10000");
const BORROW_QUANTITY_MIN = Number.parseFloat("100");
const BORROW_QUANTITY_MAX = Number.parseFloat("5000");
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
        tokenAddress: string;
    }> = [];

    constructor(
        private readonly orderRepository: OrderRepository,
        @InjectRepository(Market)
        private readonly marketRepository: Repository<Market>,
        @InjectRepository(Token)
        private readonly tokenRepository: Repository<Token>,
        private readonly ordersService: OrdersService,
        private readonly dataSource: DataSource,
        private readonly eventsGateway: EventsGateway,
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
            const rate = this.getRandomLendRate();
            const account =
                ACCOUNTS[Math.floor(Math.random() * ACCOUNTS.length)];

            await this.ordersService.createLendLimitOrder(
                { assetId, amount, marketIds, rate },
                account.wallet,
                account.privyUserId,
            );
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
            const rate = this.getRandomBorrowRate();
            const account =
                ACCOUNTS[Math.floor(Math.random() * ACCOUNTS.length)];

            await this.ordersService.createBorrowLimitOrder(
                { assetId, amount, marketIds, rate },
                account.wallet,
                account.privyUserId,
            );
        } catch (error) {
            this.logger.error(
                `Failed to insert borrow order: ${(error as Error).message}`,
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
            const incrementNum = Math.max(
                1,
                Math.round(remainingNum * fraction),
            );
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
            // Prefer partially filled orders, fall back to open.
            // Only pick orders that have order_markets rows (old/stale orders may lack them).
            let order = await this.orderRepository
                .createQueryBuilder("order")
                .innerJoin("order_markets", "om", "om.order_id = order.id")
                .where("order.status = :status", {
                    status: OrderStatus.PartiallyFilled,
                })
                .orderBy("RANDOM()")
                .getOne();

            if (!order) {
                order = await this.orderRepository
                    .createQueryBuilder("order")
                    .innerJoin("order_markets", "om", "om.order_id = order.id")
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
            const counterpartySide = isLend ? OrderSide.Borrow : OrderSide.Lend;

            await this.dataSource.transaction(async (manager) => {
                // 1. Mark original order as FILLED
                await manager.getRepository(Order).update(order!.id, {
                    filledQuantity: quantity.toString(),
                    status: OrderStatus.Filled,
                    filledSettlementFee: order!.settlementFee.split(".")[0],
                });

                // 2. Create counterparty order (FILLED immediately)
                const counterpartyOrder = manager.getRepository(Order).create({
                    accountId: counterpartyAccount.id,
                    assetId: order!.assetId,
                    side: counterpartySide,
                    type: OrderType.Limit,
                    rate: order!.rate,
                    quantity: quantity.toString(),
                    filledQuantity: quantity.toString(),
                    settlementFee: "0",
                    filledSettlementFee: "0",
                    status: OrderStatus.Filled,
                });
                const savedCounterparty = await manager
                    .getRepository(Order)
                    .save(counterpartyOrder);
                const counterpartyOrderId = savedCounterparty.id;

                // 3. Create order_market for counterparty
                const lendOrderId = isLend ? order!.id : counterpartyOrderId;
                const borrowOrderId = isLend ? counterpartyOrderId : order!.id;
                const lenderAccountId = isLend
                    ? order!.accountId
                    : counterpartyAccount.id;
                const borrowerAccountId = isLend
                    ? counterpartyAccount.id
                    : order!.accountId;

                await manager.query(
                    `INSERT INTO order_markets (order_id, market_id) VALUES ($1, $2)`,
                    [counterpartyOrderId, marketId],
                );

                // 4. Create match record
                await manager.query(
                    `INSERT INTO matches (
                        lend_order_market_id, borrow_order_market_id,
                        asset_id, lender_account_id, borrower_account_id,
                        match_amount, rate, is_borrower_taker,
                        maker_fee, taker_fee,
                        lender_settlement_fee, borrower_settlement_fee,
                        maturity
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
                    [
                        lendOrderId,
                        borrowOrderId,
                        order!.assetId,
                        lenderAccountId,
                        borrowerAccountId,
                        quantity.toString(),
                        order!.rate,
                        !isLend,
                        0,
                        0,
                        0,
                        0,
                        maturity,
                    ],
                );

                // 5. Create lend position
                await manager.query(
                    `INSERT INTO lend_positions (account_id, asset_id, market_id, shares, original_shares, amount)
                     VALUES ($1, $2, $3, $4, $5, $6)`,
                    [
                        lenderAccountId,
                        order!.assetId,
                        marketId,
                        quantity.toString(),
                        quantity.toString(),
                        quantity.toString(),
                    ],
                );

                // 6. Create borrow position
                await manager.query(
                    `INSERT INTO borrow_positions (account_id, asset_id, market_id, amount, original_debt, debt)
                     VALUES ($1, $2, $3, $4, $5, $6)`,
                    [
                        borrowerAccountId,
                        order!.assetId,
                        marketId,
                        quantity.toString(),
                        quantity.toString(),
                        quantity.toString(),
                    ],
                );
            });

            // Broadcast recent trade directly to WebSocket clients
            if (entry.assetId) {
                const trade = {
                    assetId: entry.assetId,
                    side: (isLend ? "BORROW" : "LEND") as "LEND" | "BORROW",
                    amount: quantity.toString(),
                    rate: order.rate,
                    timestamp: Date.now(),
                };
                this.eventsGateway.handleMatchCreated(trade);
                this.logger.log(
                    `Broadcast recent-trade for asset ${entry.assetId}`,
                );
            }

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
