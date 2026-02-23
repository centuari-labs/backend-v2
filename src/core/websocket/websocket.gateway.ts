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
import { Order } from "src/orders/entities/order.entity";
import { OrderStatus } from "src/orders/constants/order.constants";
import { toPercentage } from "src/common/utils/number.utils";
import type {
    OrderbookUpdateDto,
    SubscribeOrderbookDto,
} from "./dto/orderbook.dto";

interface OrderbookSnapshotMessage {
    loanToken: string;
    maturity: number;
    lend: { price: number; apr: string; amount: string } | null;
    borrow: { price: number; apr: string; amount: string } | null;
    timestamp: number;
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
    private orderbookCache = new Map<string, OrderbookUpdateDto>();

    constructor(private readonly natsService: NatsService) {}

    afterInit(_server: Server) {
        this.logger.log("WebSocket Gateway initialized");
        this.setupNatsSubscriptions();
    }

    handleConnection(client: Socket) {
        this.logger.log(`Client connected: ${client.id}`);
    }

    handleDisconnect(client: Socket) {
        this.logger.log(`Client disconnected: ${client.id}`);
    }

    private setupNatsSubscriptions() {
        if (this.isNatsSubscribed) return;

        // Subscribe to order status updates for position tracking
        this.natsService
            .subscribe<Order[]>("orders.>", (orders, subject) => {
                for (const order of orders) {
                    if (order.status === OrderStatus.Filled) {
                        this.server
                            .to(`user:${order.accountId}`)
                            .emit("active-positions", { order, subject });
                    }

                    if (
                        (order.status === OrderStatus.Open ||
                            order.status === OrderStatus.PartiallyFilled) &&
                        subject.includes(".limit")
                    ) {
                        this.server
                            .to(`user:${order.accountId}`)
                            .emit("open-positions", { order, subject });
                    }
                }
            })
            .catch((err) =>
                this.logger.error("Failed to subscribe to orders.>", err),
            );

        // Subscribe to orderbook snapshots from matching engine
        this.natsService
            .subscribe<OrderbookSnapshotMessage>(
                "orderbook.snapshot",
                (data) => {
                    const room = `orderbook:${data.loanToken}:${data.maturity}`;

                    const update: OrderbookUpdateDto = {
                        loanToken: data.loanToken,
                        maturity: data.maturity,
                        lend: data.lend
                            ? {
                                  price: toPercentage(data.lend.price),
                                  apr: data.lend.apr,
                                  amount: data.lend.amount,
                              }
                            : null,
                        borrow: data.borrow
                            ? {
                                  price: toPercentage(data.borrow.price),
                                  apr: data.borrow.apr,
                                  amount: data.borrow.amount,
                              }
                            : null,
                        timestamp: data.timestamp,
                    };

                    this.orderbookCache.set(room, update);
                    this.server.to(room).emit("orderbook-update", update);
                },
            )
            .catch((err) =>
                this.logger.error(
                    "Failed to subscribe to orderbook.snapshot",
                    err,
                ),
            );

        this.isNatsSubscribed = true;
        this.logger.log("Subscribed to NATS topics");
    }

    @SubscribeMessage("subscribe-orderbook")
    handleSubscribeOrderbook(
        @ConnectedSocket() client: Socket,
        @MessageBody() body: SubscribeOrderbookDto,
    ) {
        const room = `orderbook:${body.loanToken}:${body.maturity}`;
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
        const room = `orderbook:${body.loanToken}:${body.maturity}`;
        client.leave(room);
        this.logger.log(`Client ${client.id} left ${room}`);
        return { success: true, room };
    }

    // TODO - active position need to be calculated from SC
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
