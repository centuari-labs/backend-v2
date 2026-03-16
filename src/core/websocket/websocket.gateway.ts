import {
    ConnectedSocket,
    MessageBody,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnGatewayInit,
    SubscribeMessage,
    WebSocketGateway,
    WebSocketServer,
} from "@nestjs/websockets";
import { Logger } from "@nestjs/common";
import { Server, Socket } from "socket.io";
import { DataSource } from "typeorm";
import { NatsService } from "../nats/nats.service";
import { type UserPositionsDto } from "./dto/user.dto";
import {
    OrderSide,
    OrderStatus,
    OrderType,
} from "src/orders/constants/order.constants";
import { toPercentage } from "src/common/utils/number.utils";
import type {
    OrderbookLevel,
    OrderbookUpdateDto,
    SubscribeOrderbookDto,
} from "./dto/orderbook.dto";
import type {
    RecentTradeDto,
    SubscribeRecentTradesDto,
} from "./dto/recent-trades.dto";
import type { PricesDto } from "./dto/prices.dto";

/** Shape of order creation messages published by backend-v2 to NATS (flat, no envelope) */
interface OrderCreationMessage {
    orderId: string;
    walletAddress: string;
    loanToken: string;
    assetId?: string;
    markets: Array<{ marketId: string; maturity: number }>;
    side: OrderSide;
    type: OrderType;
    status: OrderStatus;
    originalAmount: string;
    remainingAmount: string;
    settlementFeeAmount: string;
    rate?: number;
}

/** Shape of cancel messages published by backend-v2 to NATS (flat, no envelope) */
interface OrderCancelMessage {
    orderId: string;
    walletAddress: string;
}

/** Shape of status updates published by matching engine directly */
interface OrderStatusMessage {
    orderId: string;
    status: string;
    remainingAmount: string;
    timestamp: number;
}

/** In-memory tracked order state */
interface TrackedOrder {
    orderId: string;
    assetId: string;
    side: OrderSide;
    type: OrderType;
    rate: number;
    remainingAmount: string;
    originalAmount: string;
    accountId: string;
    status: OrderStatus;
    walletAddress: string;
    markets: Array<{ marketId: string; maturity: number }>;
    settlementFeeAmount: string;
}

const websocketCorsOrigin =
    process.env.NODE_ENV === "production"
        ? (process.env.WS_CORS_ORIGINS ?? "")
              .split(",")
              .map((origin) => origin.trim())
              .filter((origin) => origin.length > 0)
        : "*";

@WebSocketGateway({
    cors: {
        origin: websocketCorsOrigin,
    },
})
export class EventsGateway
    implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
    @WebSocketServer()
    server: Server;

    private readonly logger = new Logger(EventsGateway.name);
    private isNatsSubscribed = false;

    /** In-memory order state indexed by orderId */
    private orderState = new Map<string, TrackedOrder>();

    /** Cached aggregated orderbook per assetId room */
    private orderbookCache = new Map<string, OrderbookUpdateDto>();

    /** Cached recent trades per assetId room (max 20 per room) */
    private recentTradesCache = new Map<string, RecentTradeDto[]>();
    private readonly maxRecentTrades = 20;

    /** Cached latest prices keyed by assetId */
    private pricesCache: PricesDto["prices"] = {};

    /** Tracks which assetIds have already been loaded from DB */
    private dbLoadedAssets = new Set<string>();

    constructor(
        private readonly natsService: NatsService,
        private readonly dataSource: DataSource,
    ) {}

    afterInit(_server: Server) {
        this.logger.log("WebSocket Gateway initialized");
        return this.setupNatsSubscriptions().catch((err) =>
            this.logger.error(
                `Failed to set up NATS subscriptions: ${(err as Error).message}`,
            ),
        );
    }

    handleConnection(client: Socket) {
        this.logger.log(`Client connected: ${client.id}`);
    }

    handleDisconnect(client: Socket) {
        this.logger.log(`Client disconnected: ${client.id}`);
    }

    private async setupNatsSubscriptions(): Promise<void> {
        if (this.isNatsSubscribed) return;

        // Wait for NATS connection — afterInit can fire before NatsService.onModuleInit completes
        const maxRetries = 10;
        const retryDelayMs = 1000;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            if (this.natsService.isConnected()) break;
            this.logger.log(
                `Waiting for NATS connection (attempt ${attempt}/${maxRetries})...`,
            );
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        }

        if (!this.natsService.isConnected()) {
            this.logger.error(
                "NATS connection not available after retries. Subscriptions not set up.",
            );
            return;
        }

        await this.natsService.subscribe(
            "orders.>",
            (data: unknown, subject: string) => {
                try {
                    this.handleOrdersMessage(data, subject);
                } catch (err) {
                    this.logger.error(
                        `Error handling NATS message on ${subject}: ${(err as Error).message}`,
                    );
                }
            },
        );

        await this.natsService.subscribe(
            "matches.>",
            (data: unknown, subject: string) => {
                try {
                    if (subject === "matches.created") {
                        this.handleMatchCreated(data as RecentTradeDto);
                    }
                } catch (err) {
                    this.logger.error(
                        `Error handling NATS message on ${subject}: ${(err as Error).message}`,
                    );
                }
            },
        );

        this.isNatsSubscribed = true;
        this.logger.log("Subscribed to NATS topics");
    }

    private handleOrdersMessage(data: unknown, subject: string) {
        if (subject === "orders.status") {
            this.handleStatusUpdate(data as OrderStatusMessage).catch(
                (err) =>
                    this.logger.error(
                        `Error in handleStatusUpdate: ${(err as Error).message}`,
                    ),
            );
        } else if (subject === "orders.cancel") {
            this.handleCancelMessage(data as OrderCancelMessage);
        } else if (
            subject.startsWith("orders.lend.") ||
            subject.startsWith("orders.borrow.")
        ) {
            this.handleOrderCreation(
                data as OrderCreationMessage,
                subject,
            );
        }
    }

    private handleOrderCreation(
        msg: OrderCreationMessage,
        subject: string,
    ) {
        const assetId = msg.assetId ?? msg.loanToken;

        const tracked: TrackedOrder = {
            orderId: msg.orderId,
            assetId,
            side: msg.side,
            type: msg.type,
            rate: msg.rate ?? 0,
            remainingAmount: msg.remainingAmount,
            originalAmount: msg.originalAmount,
            accountId: msg.walletAddress,
            status: msg.status,
            walletAddress: msg.walletAddress,
            markets: msg.markets,
            settlementFeeAmount: msg.settlementFeeAmount,
        };

        this.orderState.set(msg.orderId, tracked);
        this.aggregateAndBroadcastOrderbook(assetId);
        this.emitUserPosition(tracked, subject);
    }

    private async handleStatusUpdate(msg: OrderStatusMessage) {
        let tracked = this.orderState.get(msg.orderId);
        if (!tracked) {
            await this.loadSingleOrderFromDb(msg.orderId);
            tracked = this.orderState.get(msg.orderId);
            if (!tracked) {
                this.logger.debug(
                    `Status update for unknown order ${msg.orderId}, ignoring`,
                );
                return;
            }
        }

        tracked.status = msg.status as OrderStatus;
        tracked.remainingAmount = msg.remainingAmount;

        this.aggregateAndBroadcastOrderbook(tracked.assetId);
        this.emitUserPosition(tracked, "orders.status");
    }

    private handleCancelMessage(msg: OrderCancelMessage) {
        const { orderId } = msg;
        const tracked = this.orderState.get(orderId);
        if (!tracked) {
            this.logger.debug(
                `Cancel for unknown order ${orderId}, ignoring`,
            );
            return;
        }

        tracked.status = OrderStatus.Cancelled;

        this.aggregateAndBroadcastOrderbook(tracked.assetId);
        this.emitUserPosition(tracked, "orders.cancel");
    }

    // ─── Prices ────────────────────────────────────────────────────────────

    /**
     * Broadcast the latest prices to all clients subscribed to the prices room.
     * Intended to be called by the PriceWorker after each successful price fetch.
     */
    public broadcastPrices(prices: PricesDto["prices"]) {
        this.pricesCache = prices;

        const room = "prices";
        const socketsInRoom = this.server.sockets.adapter.rooms.get(room);
        this.logger.log(
            `prices-update → room=${room}, clients=${socketsInRoom?.size ?? 0}, assets=${Object.keys(
                prices,
            ).length}`,
        );

        this.server.to(room).emit("prices-update", prices);
    }

    private emitUserPosition(tracked: TrackedOrder, subject: string) {
        const room = `user:${tracked.accountId}`;
        const payload = {
            order: this.toOrderPayload(tracked),
            subject,
        };

        if (tracked.status === OrderStatus.Filled) {
            this.server.to(room).emit("active-positions", payload);
        }

        if (
            (tracked.status === OrderStatus.Open ||
                tracked.status === OrderStatus.PartiallyFilled) &&
            tracked.type === OrderType.Limit
        ) {
            this.server.to(room).emit("open-positions", payload);
        }
    }

    private toOrderPayload(tracked: TrackedOrder) {
        return {
            orderId: tracked.orderId,
            walletAddress: tracked.walletAddress,
            assetId: tracked.assetId,
            markets: tracked.markets,
            side: tracked.side,
            type: tracked.type,
            status: tracked.status,
            originalAmount: tracked.originalAmount,
            remainingAmount: tracked.remainingAmount,
            settlementFeeAmount: tracked.settlementFeeAmount,
            rate: tracked.rate,
            accountId: tracked.accountId,
        };
    }

    // ─── DB Hydration ─────────────────────────────────────────────────

    private async loadOrdersFromDb(assetId: string): Promise<void> {
        if (this.dbLoadedAssets.has(assetId)) return;

        try {
            const rows: Array<{
                id: string;
                asset_id: string;
                side: OrderSide;
                type: OrderType;
                rate: string;
                quantity: string;
                filled_quantity: string;
                settlement_fee: string;
                account_id: string;
                status: OrderStatus;
                user_wallet: string;
                markets: Array<{ marketId: string; maturity: number }> | null;
            }> = await this.dataSource.query(
                `SELECT o.id, o.asset_id, o.side, o.type, o.rate,
                        o.quantity, o.filled_quantity, o.settlement_fee,
                        o.account_id, o.status,
                        a.user_wallet,
                        json_agg(json_build_object(
                            'marketId', om.market_id,
                            'maturity', COALESCE(EXTRACT(EPOCH FROM m.maturity)::int, 0)
                        )) FILTER (WHERE om.market_id IS NOT NULL) as markets
                 FROM orders o
                 JOIN accounts a ON a.id = o.account_id
                 LEFT JOIN order_markets om ON om.order_id = o.id
                 LEFT JOIN markets m ON m.id = om.market_id
                 WHERE o.asset_id = $1
                   AND o.type = 'LIMIT'
                   AND o.status IN ('OPEN', 'PARTIALLY_FILLED')
                 GROUP BY o.id, a.user_wallet`,
                [assetId],
            );

            for (const row of rows) {
                if (this.orderState.has(row.id)) continue;
                const remaining =
                    BigInt(row.quantity) -
                    BigInt(row.filled_quantity || "0");
                this.orderState.set(row.id, {
                    orderId: row.id,
                    assetId: row.asset_id,
                    side: row.side,
                    type: row.type,
                    rate: Number(row.rate),
                    remainingAmount:
                        remaining >= 0n ? remaining.toString() : "0",
                    originalAmount: row.quantity,
                    accountId: row.account_id,
                    status: row.status,
                    walletAddress: row.user_wallet,
                    markets: row.markets ?? [],
                    settlementFeeAmount: row.settlement_fee,
                });
            }

            this.dbLoadedAssets.add(assetId);
            this.logger.log(
                `Loaded ${rows.length} active limit orders from DB for asset ${assetId}`,
            );
        } catch (err) {
            this.logger.error(
                `Failed to load orders from DB for asset ${assetId}: ${(err as Error).message}`,
            );
        }
    }

    private async loadSingleOrderFromDb(
        orderId: string,
    ): Promise<void> {
        try {
            const rows: Array<{
                id: string;
                asset_id: string;
                side: OrderSide;
                type: OrderType;
                rate: string;
                quantity: string;
                filled_quantity: string;
                settlement_fee: string;
                account_id: string;
                status: OrderStatus;
                user_wallet: string;
                markets: Array<{ marketId: string; maturity: number }> | null;
            }> = await this.dataSource.query(
                `SELECT o.id, o.asset_id, o.side, o.type, o.rate,
                        o.quantity, o.filled_quantity, o.settlement_fee,
                        o.account_id, o.status,
                        a.user_wallet,
                        json_agg(json_build_object(
                            'marketId', om.market_id,
                            'maturity', COALESCE(EXTRACT(EPOCH FROM m.maturity)::int, 0)
                        )) FILTER (WHERE om.market_id IS NOT NULL) as markets
                 FROM orders o
                 JOIN accounts a ON a.id = o.account_id
                 LEFT JOIN order_markets om ON om.order_id = o.id
                 LEFT JOIN markets m ON m.id = om.market_id
                 WHERE o.id = $1
                 GROUP BY o.id, a.user_wallet`,
                [orderId],
            );

            if (rows.length === 0) return;

            const row = rows[0];
            const remaining =
                BigInt(row.quantity) - BigInt(row.filled_quantity || "0");
            this.orderState.set(row.id, {
                orderId: row.id,
                assetId: row.asset_id,
                side: row.side,
                type: row.type,
                rate: Number(row.rate),
                remainingAmount:
                    remaining >= 0n ? remaining.toString() : "0",
                originalAmount: row.quantity,
                accountId: row.account_id,
                status: row.status,
                walletAddress: row.user_wallet,
                markets: row.markets ?? [],
                settlementFeeAmount: row.settlement_fee,
            });
        } catch (err) {
            this.logger.error(
                `Failed to load order ${orderId} from DB: ${(err as Error).message}`,
            );
        }
    }

    // ─── Orderbook ──────────────────────────────────────────────────

    private aggregateAndBroadcastOrderbook(assetId: string) {
        const activeOrders = Array.from(this.orderState.values()).filter(
            (o) =>
                o.assetId === assetId &&
                o.type === OrderType.Limit &&
                (o.status === OrderStatus.Open ||
                    o.status === OrderStatus.PartiallyFilled),
        );

        const lendLevels = this.aggregateLevels(
            activeOrders.filter((o) => o.side === OrderSide.Lend),
            true,
        );
        const borrowLevels = this.aggregateLevels(
            activeOrders.filter((o) => o.side === OrderSide.Borrow),
            false,
        );

        const update: OrderbookUpdateDto = {
            assetId,
            lend: lendLevels,
            borrow: borrowLevels,
            timestamp: Date.now(),
        };

        const room = `orderbook:${assetId}`;
        this.orderbookCache.set(room, update);
        this.server.to(room).emit("orderbook-update", update);
    }

    private aggregateLevels(
        orders: TrackedOrder[],
        descending = false,
    ): OrderbookLevel[] {
        const byRate = new Map<number, { amount: bigint; count: number }>();

        for (const order of orders) {
            const existing = byRate.get(order.rate);
            const remaining = BigInt(order.remainingAmount);
            if (existing) {
                existing.amount += remaining;
                existing.count += 1;
            } else {
                byRate.set(order.rate, { amount: remaining, count: 1 });
            }
        }

        return Array.from(byRate.entries())
            .sort((a, b) =>
                descending ? b[0] - a[0] : a[0] - b[0],
            )
            .map(([rateBps, { amount, count }]) => ({
                rate: toPercentage(rateBps),
                amount: amount.toString(),
                orders: count,
            }));
    }

    @SubscribeMessage("subscribe-prices")
    handleSubscribePrices(@ConnectedSocket() client: Socket) {
        const room = "prices";
        client.join(room);
        this.logger.log(`Client ${client.id} joined ${room}`);

        if (Object.keys(this.pricesCache).length > 0) {
            client.emit("prices-snapshot", this.pricesCache);
        }

        return { success: true, room };
    }

    @SubscribeMessage("unsubscribe-prices")
    handleUnsubscribePrices(@ConnectedSocket() client: Socket) {
        const room = "prices";
        client.leave(room);
        this.logger.log(`Client ${client.id} left ${room}`);
        return { success: true, room };
    }

    @SubscribeMessage("subscribe-orderbook")
    async handleSubscribeOrderbook(
        @ConnectedSocket() client: Socket,
        @MessageBody() body: SubscribeOrderbookDto,
    ) {
        const room = `orderbook:${body.assetId}`;
        client.join(room);
        this.logger.log(`Client ${client.id} joined ${room}`);

        let cached = this.orderbookCache.get(room);
        if (!cached) {
            await this.loadOrdersFromDb(body.assetId);
            this.aggregateAndBroadcastOrderbook(body.assetId);
            cached = this.orderbookCache.get(room);
        }
        if (cached) {
            client.emit("orderbook-update", cached);
        }

        return { success: true, room };
    }

    @SubscribeMessage("unsubscribe-orderbook")
    handleUnsubscribeOrderbook(
        @ConnectedSocket() client: Socket,
        @MessageBody() body: SubscribeOrderbookDto,
    ) {
        const room = `orderbook:${body.assetId}`;
        client.leave(room);
        this.logger.log(`Client ${client.id} left ${room}`);
        return { success: true, room };
    }

    @SubscribeMessage("active-positions")
    handleActivePosition(
        @ConnectedSocket() client: Socket,
        @MessageBody() body: UserPositionsDto,
    ) {
        const room = `user:${body.accountId}`;
        client.join(room);
        this.logger.log(`Client ${client.id} joined ${room}`);
        return { success: true, room };
    }

    @SubscribeMessage("open-positions")
    handleOpenPosition(
        @ConnectedSocket() client: Socket,
        @MessageBody() body: UserPositionsDto,
    ) {
        const room = `user:${body.accountId}`;
        client.join(room);
        this.logger.log(`Client ${client.id} joined ${room}`);
        return { success: true, room };
    }

    // ─── Recent Trades ────────────────────────────────────────────────

    public handleMatchCreated(trade: RecentTradeDto) {
        const room = `recent-trades:${trade.assetId}`;
        const cached = this.recentTradesCache.get(room) ?? [];
        cached.unshift(trade);
        if (cached.length > this.maxRecentTrades) {
            cached.length = this.maxRecentTrades;
        }
        this.recentTradesCache.set(room, cached);

        const socketsInRoom = this.server.sockets.adapter.rooms.get(room);
        this.logger.log(
            `recent-trade → room=${room}, clients=${socketsInRoom?.size ?? 0}, trade=${JSON.stringify(trade)}`,
        );

        this.server.to(room).emit("recent-trade", trade);
    }

    @SubscribeMessage("subscribe-recent-trades")
    handleSubscribeRecentTrades(
        @ConnectedSocket() client: Socket,
        @MessageBody() body: SubscribeRecentTradesDto,
    ) {
        const room = `recent-trades:${body.assetId}`;
        client.join(room);
        this.logger.log(`Client ${client.id} joined ${room}`);

        const cached = this.recentTradesCache.get(room);
        if (cached && cached.length > 0) {
            client.emit("recent-trades-snapshot", cached);
        }

        return { success: true, room };
    }

    @SubscribeMessage("unsubscribe-recent-trades")
    handleUnsubscribeRecentTrades(
        @ConnectedSocket() client: Socket,
        @MessageBody() body: SubscribeRecentTradesDto,
    ) {
        const room = `recent-trades:${body.assetId}`;
        client.leave(room);
        this.logger.log(`Client ${client.id} left ${room}`);
        return { success: true, room };
    }
}
