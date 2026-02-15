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
    private orderbookCache = new Map<string, Record<string, unknown>>();

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

        this.natsService.subscribe<Order[]>("orders.>", (orders, subject) => {
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
        });

        this.natsService.subscribe<Record<string, unknown>>('orders.*', (data, subject) => {
            this.orderbookCache.set(subject, data);
            this.server.emit("orderbook-update", { data, subject });
        });

        this.isNatsSubscribed = true;
        this.logger.log("Subscribed to NATS orders topics");
    }

    @SubscribeMessage("orderbook")
    handleSubscribeOrderbook(@ConnectedSocket() client: Socket) {
        this.logger.log(`Client ${client.id} subscribed to orderbook`);

        for (const [subject, data] of this.orderbookCache.entries()) {
            client.emit("orderbook-update", { data, subject });
        }

        return { success: true, message: "Subscribed to orderbook" };
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
