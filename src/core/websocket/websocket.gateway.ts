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
import { Inject, Logger, OnModuleDestroy, forwardRef } from "@nestjs/common";
import { Server, Socket } from "socket.io";
import { z } from "zod";
import { NatsService } from "../nats/nats.service";
import { PrivyAuthStrategy } from "../../common/guards/strategies/privy-auth.strategy";
import { DevAuthStrategy } from "../../common/guards/strategies/dev-auth.strategy";
import {
    OrderRepository,
    type OrderForTracking,
} from "src/orders/repositories/order.repository";
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

function parseWsCorsOrigins(raw?: string): string[] {
    return (raw ?? "")
        .split(",")
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0);
}

/**
 * WS CORS allow-list. Never `"*"`: an explicit allow-list from WS_CORS_ORIGINS
 * is required in production, and falls back to local dev origins (not a
 * wildcard) elsewhere so a misconfigured non-prod box still isn't wide open.
 */
const websocketCorsOrigin: string[] = (() => {
    const configured = parseWsCorsOrigins(process.env.WS_CORS_ORIGINS);
    if (configured.length > 0) return configured;
    if (process.env.NODE_ENV === "production") return [];
    return [
        "http://localhost:3200",
        "http://localhost:3000",
        "http://127.0.0.1:3200",
    ];
})();

/** Validated shape of an inbound user-positions subscribe message. */
const userPositionsSchema = z.object({
    accountId: z.string().min(1),
});

/** Validated shape of order-status updates received over NATS. */
const orderStatusSchema = z.object({
    orderId: z.string().min(1),
    status: z.string().min(1),
    remainingAmount: z.string(),
    timestamp: z.number(),
});

/** Validated shape of order-cancel messages received over NATS. */
const orderCancelSchema = z.object({
    orderId: z.string().min(1),
    walletAddress: z.string().min(1),
});

/** Validated shape of recent-trade messages (matches.created) before broadcast. */
const recentTradeSchema = z.object({
    assetId: z.string().min(1),
    side: z.enum(["LEND", "BORROW"]),
    amount: z.string(),
    rate: z.number(),
    timestamp: z.number(),
});

@WebSocketGateway({
    cors: {
        origin: websocketCorsOrigin,
    },
})
export class EventsGateway
    implements
        OnGatewayInit,
        OnGatewayConnection,
        OnGatewayDisconnect,
        OnModuleDestroy
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

    /** Short-lived cache for active order IDs to reduce DB hits */
    private activeIdsCache = new Map<
        string,
        { ids: Set<string>; expiresAt: number }
    >();
    private static readonly ACTIVE_IDS_TTL_MS = 5_000;

    /** Periodic cleanup interval handle */
    private cleanupInterval: ReturnType<typeof setInterval>;
    private static readonly CLEANUP_INTERVAL_MS = 60_000;

    constructor(
        private readonly natsService: NatsService,
        @Inject(forwardRef(() => OrderRepository))
        private readonly orderRepository: OrderRepository,
        private readonly privyAuthStrategy: PrivyAuthStrategy,
    ) {}

    afterInit(_server: Server) {
        this.logger.log("WebSocket Gateway initialized");
        this.cleanupInterval = setInterval(
            () => this.cleanupTerminalOrders(),
            EventsGateway.CLEANUP_INTERVAL_MS,
        );
        return this.setupNatsSubscriptions().catch((err) =>
            this.logger.error(
                `Failed to set up NATS subscriptions: ${(err as Error).message}`,
            ),
        );
    }

    onModuleDestroy() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
    }

    async handleConnection(client: Socket) {
        // Authenticate the socket on connect. The verified wallet address is
        // stored on `socket.data` and is the ONLY trusted source for the user
        // room — client-supplied `accountId` is checked against it (BOLA fix).
        // Connections without a valid token still connect (so public rooms like
        // prices / orderbook / recent-trades work) but cannot join user rooms.
        try {
            const token = this.extractToken(client);
            if (token) {
                const walletAddress = await this.authenticateToken(token);
                client.data.walletAddress = walletAddress;
                this.logger.log(
                    `Client connected: ${client.id} (wallet=${walletAddress})`,
                );
                return;
            }
        } catch (err) {
            this.logger.warn(
                `Client ${client.id} provided an invalid auth token: ${
                    err instanceof Error ? err.message : String(err)
                }`,
            );
        }
        this.logger.log(`Client connected: ${client.id} (unauthenticated)`);
    }

    /**
     * Extract a bearer token from the Socket.IO handshake. Supports
     * `auth: { token }` (preferred) and an `Authorization: Bearer <token>`
     * header, mirroring the REST AuthGuard.
     */
    private extractToken(client: Socket): string | null {
        const authToken = client.handshake.auth?.token;
        if (typeof authToken === "string" && authToken.length > 0) {
            return authToken.startsWith("Bearer ")
                ? authToken.slice(7)
                : authToken;
        }
        const header = client.handshake.headers?.authorization;
        if (typeof header === "string" && header.startsWith("Bearer ")) {
            return header.slice(7);
        }
        return null;
    }

    /**
     * Verify a token and return its wallet address, reusing the same Privy
     * verification the REST PrivyAuthStrategy uses. The dev-token path is only
     * honored when ENABLE_DEV_AUTH is set and never in production
     * (DevAuthStrategy refuses to construct under NODE_ENV=production).
     */
    private async authenticateToken(token: string): Promise<string> {
        if (
            process.env.ENABLE_DEV_AUTH === "true" &&
            DevAuthStrategy.isDevToken(token)
        ) {
            const devUser = await new DevAuthStrategy().validate(token);
            return devUser.walletAddress;
        }
        const user = await this.privyAuthStrategy.validate(token);
        return user.walletAddress;
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
                        const parsed = recentTradeSchema.safeParse(data);
                        if (!parsed.success) {
                            this.logger.warn(
                                `Dropping malformed matches.created message: ${parsed.error.message}`,
                            );
                            return;
                        }
                        this.handleMatchCreated(parsed.data);
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
            const parsed = orderStatusSchema.safeParse(data);
            if (!parsed.success) {
                this.logger.warn(
                    `Dropping malformed orders.status message: ${parsed.error.message}`,
                );
                return;
            }
            this.handleStatusUpdate(parsed.data).catch((err) =>
                this.logger.error(
                    `Error in handleStatusUpdate: ${(err as Error).message}`,
                ),
            );
        } else if (subject === "orders.cancel") {
            const parsed = orderCancelSchema.safeParse(data);
            if (!parsed.success) {
                this.logger.warn(
                    `Dropping malformed orders.cancel message: ${parsed.error.message}`,
                );
                return;
            }
            this.handleCancelMessage(parsed.data).catch((err) =>
                this.logger.error(
                    `Error in handleCancelMessage: ${(err as Error).message}`,
                ),
            );
        } else if (
            subject.startsWith("orders.lend.") ||
            subject.startsWith("orders.borrow.")
        ) {
            this.handleOrderCreation(
                data as OrderCreationMessage,
                subject,
            ).catch((err) =>
                this.logger.error(
                    `Error in handleOrderCreation: ${(err as Error).message}`,
                ),
            );
        }
    }

    private async handleOrderCreation(
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
        await this.aggregateAndBroadcastOrderbook(assetId);
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

        await this.aggregateAndBroadcastOrderbook(tracked.assetId);
        this.emitUserPosition(tracked, "orders.status");

        // Eagerly remove terminal orders from memory
        if (
            tracked.status === OrderStatus.Filled ||
            tracked.status === OrderStatus.Cancelled
        ) {
            this.orderState.delete(msg.orderId);
        }
    }

    private async handleCancelMessage(msg: OrderCancelMessage) {
        const { orderId } = msg;
        const tracked = this.orderState.get(orderId);
        if (!tracked) {
            this.logger.debug(`Cancel for unknown order ${orderId}, ignoring`);
            return;
        }

        tracked.status = OrderStatus.Cancelled;

        await this.aggregateAndBroadcastOrderbook(tracked.assetId);
        this.emitUserPosition(tracked, "orders.cancel");

        // Eagerly remove cancelled order from memory
        this.orderState.delete(orderId);
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
            `prices-update → room=${room}, clients=${socketsInRoom?.size ?? 0}, assets=${
                Object.keys(prices).length
            }`,
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
        try {
            const rows =
                await this.orderRepository.findActiveLimitOrdersForOrderbook(
                    assetId,
                );

            for (const row of rows) {
                const remaining =
                    BigInt(row.quantity) - BigInt(row.filledQuantity || "0");
                this.orderState.set(row.id, {
                    orderId: row.id,
                    assetId: row.assetId,
                    side: row.side,
                    type: row.type,
                    rate: row.rate,
                    remainingAmount:
                        remaining >= 0n ? remaining.toString() : "0",
                    originalAmount: row.quantity,
                    accountId: row.accountId,
                    status: row.status,
                    walletAddress: row.userWallet,
                    markets: row.markets,
                    settlementFeeAmount: row.settlementFee,
                });
            }

            this.logger.log(
                `Loaded ${rows.length} active limit orders from DB for asset ${assetId}`,
            );
        } catch (err) {
            this.logger.error(
                `Failed to load orders from DB for asset ${assetId}: ${(err as Error).message}`,
            );
        }
    }

    private async loadSingleOrderFromDb(orderId: string): Promise<void> {
        try {
            const row =
                await this.orderRepository.findOrderForTracking(orderId);

            if (!row) return;

            const remaining =
                BigInt(row.quantity) - BigInt(row.filledQuantity || "0");
            this.orderState.set(row.id, {
                orderId: row.id,
                assetId: row.assetId,
                side: row.side,
                type: row.type,
                rate: row.rate,
                remainingAmount: remaining >= 0n ? remaining.toString() : "0",
                originalAmount: row.quantity,
                accountId: row.accountId,
                status: row.status,
                walletAddress: row.userWallet,
                markets: row.markets,
                settlementFeeAmount: row.settlementFee,
            });
        } catch (err) {
            this.logger.error(
                `Failed to load order ${orderId} from DB: ${(err as Error).message}`,
            );
        }
    }

    // ─── Orderbook ──────────────────────────────────────────────────

    private async aggregateAndBroadcastOrderbook(assetId: string) {
        // Fast path: build from in-memory state
        const activeOrders = Array.from(this.orderState.values()).filter(
            (o) =>
                o.assetId === assetId &&
                o.type === OrderType.Limit &&
                (o.status === OrderStatus.Open ||
                    o.status === OrderStatus.PartiallyFilled),
        );

        // DB validation: fetch valid order IDs and discard phantoms
        const validIds = await this.fetchActiveOrderIds(assetId);
        const validOrders = activeOrders.filter((o) => validIds.has(o.orderId));

        // Clean up phantoms from orderState so they don't accumulate
        for (const order of activeOrders) {
            if (!validIds.has(order.orderId)) {
                this.orderState.delete(order.orderId);
            }
        }

        const lendLevels = this.aggregateLevels(
            validOrders.filter((o) => o.side === OrderSide.Lend),
            false, // ascending: best lend (lowest rate) first
        );
        const borrowLevels = this.aggregateLevels(
            validOrders.filter((o) => o.side === OrderSide.Borrow),
            true, // descending: best borrow (highest rate) first
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

    private async fetchActiveOrderIds(assetId: string): Promise<Set<string>> {
        const now = Date.now();
        const cached = this.activeIdsCache.get(assetId);
        if (cached && cached.expiresAt > now) {
            return cached.ids;
        }

        try {
            const ids =
                await this.orderRepository.findActiveOrderIdsByAsset(assetId);
            const idSet = new Set(ids);
            this.activeIdsCache.set(assetId, {
                ids: idSet,
                expiresAt: now + EventsGateway.ACTIVE_IDS_TTL_MS,
            });
            return idSet;
        } catch (err) {
            this.logger.error(
                `Failed to fetch active order IDs for asset ${assetId}: ${(err as Error).message}`,
            );
            return cached?.ids ?? new Set();
        }
    }

    /** Periodic sweep to remove filled/cancelled orders that may linger in memory */
    private cleanupTerminalOrders() {
        let removed = 0;
        for (const [orderId, order] of this.orderState) {
            if (
                order.status === OrderStatus.Filled ||
                order.status === OrderStatus.Cancelled
            ) {
                this.orderState.delete(orderId);
                removed++;
            }
        }
        if (removed > 0) {
            this.logger.debug(
                `Cleaned up ${removed} terminal orders from orderState`,
            );
        }
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
            .sort((a, b) => (descending ? b[0] - a[0] : a[0] - b[0]))
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

        await this.loadOrdersFromDb(body.assetId);
        await this.aggregateAndBroadcastOrderbook(body.assetId);
        const cached = this.orderbookCache.get(room);
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
        return this.joinUserRoom(client, body);
    }

    @SubscribeMessage("open-positions")
    handleOpenPosition(
        @ConnectedSocket() client: Socket,
        @MessageBody() body: UserPositionsDto,
    ) {
        return this.joinUserRoom(client, body);
    }

    /**
     * Join the per-user room, but only after asserting the requesting socket
     * actually owns `accountId`. Without this, any client could join
     * `user:<someoneElse>` and receive that user's full order stream (BOLA).
     */
    private joinUserRoom(client: Socket, body: unknown) {
        const parsed = userPositionsSchema.safeParse(body);
        if (!parsed.success) {
            this.logger.warn(
                `Client ${client.id} sent an invalid user-positions payload`,
            );
            return { success: false, error: "invalid payload" };
        }

        const walletAddress = client.data.walletAddress as string | undefined;
        if (!walletAddress) {
            this.logger.warn(
                `Client ${client.id} attempted to join a user room while unauthenticated`,
            );
            return { success: false, error: "unauthenticated" };
        }

        if (
            parsed.data.accountId.toLowerCase() !== walletAddress.toLowerCase()
        ) {
            this.logger.warn(
                `Client ${client.id} (wallet=${walletAddress}) attempted to join ` +
                    `another user's room (${parsed.data.accountId}) — rejected`,
            );
            return { success: false, error: "forbidden" };
        }

        const room = `user:${parsed.data.accountId}`;
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
