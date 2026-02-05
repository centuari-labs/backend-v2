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
import type { MatchNotificationDto } from './dto/match-notification.dto';
import type { OrderStatusUpdateDto } from './dto/order-status-update.dto';
import type { OrderErrorDto } from './dto/order-error.dto';
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
    this.subscribeToOrderbookSnapshots();
    this.subscribeToMatches();
    this.subscribeToOrderStatusUpdates();
    this.subscribeToOrderErrors();
  }

  private async subscribeToOrderbookSnapshots() {
    try {
      await this.natsService.subscribe<OrderBookSnapshotDto>(
        'orderbook.snapshot',
        (data) => {
          const roomKey = `orderbook:${data.loanToken}:${data.maturity}`;
          
          // Cache the snapshot
          this.orderbookCache.set(roomKey, data);
          
          // Broadcast to room
          this.server.to(roomKey).emit('orderbook-update', data);
          
          this.logger.debug(
            `Broadcasted orderbook snapshot to room ${roomKey}`,
          );
        },
      );
      this.logger.log('Subscribed to orderbook.snapshot');
    } catch (error) {
      this.logger.error('Failed to subscribe to orderbook.snapshot', error);
    }
  }

  private async subscribeToMatches() {
    try {
      await this.natsService.subscribe<MatchNotificationDto>(
        'matches.created',
        (data) => {
          // Broadcast match notification to all relevant rooms
          // You may want to extract loanToken/maturity from the order data
          this.server.emit('match-created', data);
          
          this.logger.debug(`Broadcasted match for order ${data.orderId}`);
        },
      );
      this.logger.log('Subscribed to matches.created');
    } catch (error) {
      this.logger.error('Failed to subscribe to matches.created', error);
    }
  }

  private async subscribeToOrderStatusUpdates() {
    try {
      await this.natsService.subscribe<OrderStatusUpdateDto>(
        'orders.status',
        (data) => {
          // Broadcast to user-specific room
          const userRoom = `user:${data.accountId}`;
          this.server.to(userRoom).emit('order-status-update', data);
          
          this.logger.debug(
            `Broadcasted order status update to room ${userRoom}`,
          );
        },
      );
      this.logger.log('Subscribed to orders.status');
    } catch (error) {
      this.logger.error('Failed to subscribe to orders.status', error);
    }
  }

  private async subscribeToOrderErrors() {
    try {
      await this.natsService.subscribe<OrderErrorDto>(
        'orders.error',
        (data) => {
          // Broadcast to user-specific room if accountId exists
          if (data.accountId) {
            const userRoom = `user:${data.accountId}`;
            this.server.to(userRoom).emit('order-error', data);
          }
          
          this.logger.warn(
            `Order error: ${data.errorCode} - ${data.message}`,
          );
        },
      );
      this.logger.log('Subscribed to orders.error');
    } catch (error) {
      this.logger.error('Failed to subscribe to orders.error', error);
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