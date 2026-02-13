import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { NatsService } from '../nats/nats.service';
import type { OrderBookSnapshotDto } from './dto/orderbook-snapshot.dto';
import type {
  SubscribeOrderbookDto,
  UnsubscribeOrderbookDto,
  SubscribeUserOrdersDto,
  UnsubscribeUserOrdersDto,
} from './dto/subscribe-orderbook.dto';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class EventsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(EventsGateway.name);
  private readonly orderbookCache = new Map<string, OrderBookSnapshotDto>();

  constructor(private readonly natsService: NatsService) {}

  afterInit(_server: Server) {
    this.logger.log('WebSocket Gateway initialized');
    this.setupNatsSubscriptions();
  }

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  private setupNatsSubscriptions() {
    this.subscribeToOrderCreates();
    this.subscribeToOrderCancels();
  }

  private async subscribeToOrderCreates() {
    try {
      const subjects = [
        'orders.lend.market',
        'orders.lend.limit',
        'orders.borrow.market',
        'orders.borrow.limit',
      ];

      await Promise.all(
        subjects.map((subject) =>
          this.natsService.subscribe<Record<string, unknown>>(
            subject,
            (data) => {
              this.server.emit(subject, data);
              this.logger.debug(`Broadcasted ${subject} event`);
            },
          ),
        ),
      );
      this.logger.log('Subscribed to order create topics');
    } catch (error) {
      this.logger.error('Failed to subscribe to order create topics', error);
    }
  }

  private async subscribeToOrderCancels() {
    try {
      await this.natsService.subscribe<Record<string, unknown>>(
        'orders.cancel',
        (data) => {
          this.server.emit('orders.cancel', data);
          this.logger.debug('Broadcasted orders.cancel event');
        },
      );
      this.logger.log('Subscribed to orders.cancel');
    } catch (error) {
      this.logger.error('Failed to subscribe to orders.cancel', error);
    }
  }


  @SubscribeMessage('subscribe-orderbook')
  handleSubscribeOrderbook(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: SubscribeOrderbookDto,
  ) {
    const roomKey = `orderbook:${data.loanToken}:${data.maturity}`;
    client.join(roomKey);
    
    this.logger.log(`Client ${client.id} joined room ${roomKey}`);
    
    // Send cached snapshot if available
    const cachedSnapshot = this.orderbookCache.get(roomKey);
    if (cachedSnapshot) {
      client.emit('orderbook-update', cachedSnapshot);
      this.logger.debug(`Sent cached snapshot to client ${client.id}`);
    }
    
    return { success: true, room: roomKey };
  }

  @SubscribeMessage('unsubscribe-orderbook')
  handleUnsubscribeOrderbook(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: UnsubscribeOrderbookDto,
  ) {
    const roomKey = `orderbook:${data.loanToken}:${data.maturity}`;
    client.leave(roomKey);
    
    this.logger.log(`Client ${client.id} left room ${roomKey}`);
    
    return { success: true, room: roomKey };
  }

  @SubscribeMessage('subscribe-user-orders')
  handleSubscribeUserOrders(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: SubscribeUserOrdersDto,
  ) {
    const userRoom = `user:${data.accountId}`;
    client.join(userRoom);
    
    this.logger.log(`Client ${client.id} joined user room ${userRoom}`);
    
    return { success: true, room: userRoom };
  }

  @SubscribeMessage('unsubscribe-user-orders')
  handleUnsubscribeUserOrders(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: UnsubscribeUserOrdersDto,
  ) {
    const userRoom = `user:${data.accountId}`;
    client.leave(userRoom);
    
    this.logger.log(`Client ${client.id} left user room ${userRoom}`);
    
    return { success: true, room: userRoom };
  }
}