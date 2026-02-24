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

/** Shape of order creation messages published by backend-v2 to NATS (flat, no envelope) */
interface OrderCreationMessage {
    orderId: string;
    walletAddress: string;
    loanToken: string;
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
    loanToken: string;
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

    /** Cached aggregated orderbook per loanToken room */
    private orderbookCache = new Map<string, OrderbookUpdateDto>();

    constructor(private readonly natsService: NatsService) {}

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

        this.isNatsSubscribed = true;
        this.logger.log("Subscribed to NATS topics");
    }

    private handleOrdersMessage(data: unknown, subject: string) {
        if (subject === "orders.status") {
            this.handleStatusUpdate(data as OrderStatusMessage);
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
        const tracked: TrackedOrder = {
            orderId: msg.orderId,
            loanToken: msg.loanToken,
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
        this.aggregateAndBroadcastOrderbook(msg.loanToken);
        this.emitUserPosition(tracked, subject);
    }

    private handleStatusUpdate(msg: OrderStatusMessage) {
        const tracked = this.orderState.get(msg.orderId);
        if (!tracked) {
            this.logger.debug(
                `Status update for unknown order ${msg.orderId}, ignoring`,
            );
            return;
        }

        tracked.status = msg.status as OrderStatus;
        tracked.remainingAmount = msg.remainingAmount;

        this.aggregateAndBroadcastOrderbook(tracked.loanToken);
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

        this.aggregateAndBroadcastOrderbook(tracked.loanToken);
        this.emitUserPosition(tracked, "orders.cancel");
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
            loanToken: tracked.loanToken,
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

    private aggregateAndBroadcastOrderbook(loanToken: string) {
        const activeOrders = Array.from(this.orderState.values()).filter(
            (o) =>
                o.loanToken === loanToken &&
                (o.status === OrderStatus.Open ||
                    o.status === OrderStatus.PartiallyFilled),
        );

        const lendLevels = this.aggregateLevels(
            activeOrders.filter((o) => o.side === OrderSide.Lend),
        );
        const borrowLevels = this.aggregateLevels(
            activeOrders.filter((o) => o.side === OrderSide.Borrow),
        );

        const update: OrderbookUpdateDto = {
            loanToken,
            lend: lendLevels,
            borrow: borrowLevels,
            timestamp: Date.now(),
        };

        const room = `orderbook:${loanToken}`;
        this.orderbookCache.set(room, update);
        this.server.to(room).emit("orderbook-update", update);
    }

    private aggregateLevels(orders: TrackedOrder[]): OrderbookLevel[] {
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
            .sort((a, b) => a[0] - b[0])
            .map(([rateBps, { amount, count }]) => ({
                rate: toPercentage(rateBps),
                amount: amount.toString(),
                orders: count,
            }));
    }

    @SubscribeMessage("subscribe-orderbook")
    handleSubscribeOrderbook(
        @ConnectedSocket() client: Socket,
        @MessageBody() body: SubscribeOrderbookDto,
    ) {
        const room = `orderbook:${body.loanToken}`;
        client.join(room);
        this.logger.log(`Client ${client.id} joined ${room}`);

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
        const room = `orderbook:${body.loanToken}`;
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
}
