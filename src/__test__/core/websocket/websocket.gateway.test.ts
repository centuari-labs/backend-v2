import { Test, TestingModule } from '@nestjs/testing';
import { Server, Socket } from 'socket.io';
import { EventsGateway } from '../../../core/websocket/websocket.gateway';
import { NatsService } from '../../../core/nats/nats.service';
import { OrderStatus } from '../../../orders/constants/order.constants';
import type { OrderBookSnapshotDto } from '../../../core/websocket/dto/orderbook-snapshot.dto';
import type { MatchNotificationDto } from '../../../core/websocket/dto/match-notification.dto';
import type { OrderStatusUpdateDto } from '../../../core/websocket/dto/order-status-update.dto';
import type { OrderErrorDto } from '../../../core/websocket/dto/order-error.dto';

describe('EventsGateway', () => {
  let gateway: EventsGateway;
  let natsService: jest.Mocked<NatsService>;
  let mockServer: jest.Mocked<Server>;
  let mockClient: jest.Mocked<Socket>;

  // Mock callback storage for NATS subscriptions
  const natsCallbacks = new Map<string, (data: any) => void | Promise<void>>();

  beforeEach(async () => {
    // Reset callbacks before each test
    natsCallbacks.clear();

    // Create mock NATS service
    const mockNatsService = {
      subscribe: jest.fn().mockImplementation(async (subject: string, callback: (data: any) => void | Promise<void>) => {
        natsCallbacks.set(subject, callback);
      }),
      publish: jest.fn().mockResolvedValue(undefined),
      isConnected: jest.fn().mockReturnValue(true),
      getConnection: jest.fn().mockReturnValue({}),
    };

    // Create mock Socket.IO server
    mockServer = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    } as any;

    // Create mock Socket client
    mockClient = {
      id: 'test-client-id',
      join: jest.fn(),
      leave: jest.fn(),
      emit: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventsGateway,
        {
          provide: NatsService,
          useValue: mockNatsService,
        },
      ],
    }).compile();

    gateway = module.get<EventsGateway>(EventsGateway);
    natsService = module.get(NatsService) as jest.Mocked<NatsService>;
    gateway.server = mockServer;
  });

  describe('Gateway Initialization', () => {
    it('should be defined', () => {
      expect(gateway).toBeDefined();
    });

    it('should subscribe to all NATS topics on initialization', async () => {
      await gateway.afterInit(mockServer);

      expect(natsService.subscribe).toHaveBeenCalledTimes(4);
      expect(natsService.subscribe).toHaveBeenCalledWith('orderbook.snapshot', expect.any(Function));
      expect(natsService.subscribe).toHaveBeenCalledWith('matches.created', expect.any(Function));
      expect(natsService.subscribe).toHaveBeenCalledWith('orders.status', expect.any(Function));
      expect(natsService.subscribe).toHaveBeenCalledWith('orders.error', expect.any(Function));
    });
  });

  describe('Client Connection Lifecycle', () => {
    it('should handle client connection', () => {
      expect(() => gateway.handleConnection(mockClient)).not.toThrow();
    });

    it('should handle client disconnection', () => {
      expect(() => gateway.handleDisconnect(mockClient)).not.toThrow();
    });
  });

  describe('Orderbook Subscription', () => {
    beforeEach(async () => {
      await gateway.afterInit(mockServer);
    });

    it('should allow client to subscribe to orderbook room', () => {
      const subscribeData = { loanToken: 'USDC', maturity: 1234567890 };
      const result = gateway.handleSubscribeOrderbook(mockClient, subscribeData);

      expect(mockClient.join).toHaveBeenCalledWith('orderbook:USDC:1234567890');
      expect(result).toEqual({
        success: true,
        room: 'orderbook:USDC:1234567890',
      });
    });

    it('should allow client to unsubscribe from orderbook room', () => {
      const unsubscribeData = { loanToken: 'USDC', maturity: 1234567890 };
      const result = gateway.handleUnsubscribeOrderbook(mockClient, unsubscribeData);

      expect(mockClient.leave).toHaveBeenCalledWith('orderbook:USDC:1234567890');
      expect(result).toEqual({
        success: true,
        room: 'orderbook:USDC:1234567890',
      });
    });

    it('should send cached snapshot when client subscribes', () => {
      // First, simulate an orderbook snapshot arriving from NATS
      const snapshot: OrderBookSnapshotDto = {
        loanToken: 'USDC',
        maturity: 1234567890,
        lendOrders: [],
        borrowOrders: [],
        timestamp: new Date().toISOString(),
      };

      const orderbookCallback = natsCallbacks.get('orderbook.snapshot');
      expect(orderbookCallback).toBeDefined();
      orderbookCallback!(snapshot);

      // Now subscribe a client
      const subscribeData = { loanToken: 'USDC', maturity: 1234567890 };
      gateway.handleSubscribeOrderbook(mockClient, subscribeData);

      // Should emit cached snapshot to the client
      expect(mockClient.emit).toHaveBeenCalledWith('orderbook-update', snapshot);
    });

    it('should not send cached snapshot if none exists', () => {
      const subscribeData = { loanToken: 'USDC', maturity: 9999999999 };
      gateway.handleSubscribeOrderbook(mockClient, subscribeData);

      // Should not emit anything if no cached data
      expect(mockClient.emit).not.toHaveBeenCalled();
    });
  });

  describe('User Orders Subscription', () => {
    it('should allow client to subscribe to user orders room', () => {
      const subscribeData = { accountId: 'account-123' };
      const result = gateway.handleSubscribeUserOrders(mockClient, subscribeData);

      expect(mockClient.join).toHaveBeenCalledWith('user:account-123');
      expect(result).toEqual({
        success: true,
        room: 'user:account-123',
      });
    });

    it('should allow client to unsubscribe from user orders room', () => {
      const unsubscribeData = { accountId: 'account-123' };
      const result = gateway.handleUnsubscribeUserOrders(mockClient, unsubscribeData);

      expect(mockClient.leave).toHaveBeenCalledWith('user:account-123');
      expect(result).toEqual({
        success: true,
        room: 'user:account-123',
      });
    });
  });

  describe('NATS Event Broadcasting', () => {
    beforeEach(async () => {
      await gateway.afterInit(mockServer);
    });

    describe('Orderbook Snapshot Broadcasting', () => {
      it('should broadcast orderbook snapshot to appropriate room', () => {
        const snapshot: OrderBookSnapshotDto = {
          loanToken: 'USDC',
          maturity: 1234567890,
          lendOrders: [
            {
              id: 'order-1',
              accountId: 'account-1',
              assetId: 'asset-1',
              side: 'LEND' as any,
              type: 'LIMIT' as any,
              rate: 500,
              quantity: '1000',
              filledQuantity: '0',
              settlementFee: '10',
              status: OrderStatus.Open,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
          borrowOrders: [],
          timestamp: new Date().toISOString(),
        };

        const orderbookCallback = natsCallbacks.get('orderbook.snapshot');
        expect(orderbookCallback).toBeDefined();
        orderbookCallback!(snapshot);

        expect(mockServer.to).toHaveBeenCalledWith('orderbook:USDC:1234567890');
        expect(mockServer.emit).toHaveBeenCalledWith('orderbook-update', snapshot);
      });

      it('should cache orderbook snapshot for later retrieval', () => {
        const snapshot: OrderBookSnapshotDto = {
          loanToken: 'USDC',
          maturity: 1234567890,
          lendOrders: [],
          borrowOrders: [],
          timestamp: new Date().toISOString(),
        };

        const orderbookCallback = natsCallbacks.get('orderbook.snapshot');
        orderbookCallback!(snapshot);

        // Subscribe a client after snapshot arrives
        gateway.handleSubscribeOrderbook(mockClient, {
          loanToken: 'USDC',
          maturity: 1234567890,
        });

        expect(mockClient.emit).toHaveBeenCalledWith('orderbook-update', snapshot);
      });
    });

    describe('Match Created Broadcasting', () => {
      it('should broadcast match notification globally', () => {
        const matchNotification: MatchNotificationDto = {
          orderId: 'order-123',
          matches: [
            {
              lendOrderId: 'lend-1',
              borrowOrderId: 'borrow-1',
              rate: 500,
              quantity: '100',
              timestamp: new Date().toISOString(),
            },
          ],
          timestamp: new Date().toISOString(),
        };

        const matchCallback = natsCallbacks.get('matches.created');
        expect(matchCallback).toBeDefined();
        matchCallback!(matchNotification);

        expect(mockServer.emit).toHaveBeenCalledWith('match-created', matchNotification);
      });

      it('should broadcast match with remaining order', () => {
        const matchNotification: MatchNotificationDto = {
          orderId: 'order-123',
          matches: [
            {
              lendOrderId: 'lend-1',
              borrowOrderId: 'borrow-1',
              rate: 500,
              quantity: '100',
              timestamp: new Date().toISOString(),
            },
          ],
          remainingOrder: {
            id: 'order-123',
            accountId: 'account-1',
            assetId: 'asset-1',
            side: 'LEND' as any,
            type: 'LIMIT' as any,
            rate: 500,
            quantity: '1000',
            filledQuantity: '100',
            settlementFee: '10',
            status: OrderStatus.PartiallyFilled,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          timestamp: new Date().toISOString(),
        };

        const matchCallback = natsCallbacks.get('matches.created');
        matchCallback!(matchNotification);

        expect(mockServer.emit).toHaveBeenCalledWith('match-created', matchNotification);
      });
    });

    describe('Order Status Update Broadcasting', () => {
      it('should broadcast order status update to user room', () => {
        const statusUpdate: OrderStatusUpdateDto = {
          orderId: 'order-123',
          accountId: 'account-456',
          status: OrderStatus.Filled,
          filledQuantity: '1000',
          timestamp: new Date().toISOString(),
        };

        const statusCallback = natsCallbacks.get('orders.status');
        expect(statusCallback).toBeDefined();
        statusCallback!(statusUpdate);

        expect(mockServer.to).toHaveBeenCalledWith('user:account-456');
        expect(mockServer.emit).toHaveBeenCalledWith('order-status-update', statusUpdate);
      });

      it('should broadcast partially filled status', () => {
        const statusUpdate: OrderStatusUpdateDto = {
          orderId: 'order-123',
          accountId: 'account-456',
          status: OrderStatus.PartiallyFilled,
          filledQuantity: '500',
          timestamp: new Date().toISOString(),
        };

        const statusCallback = natsCallbacks.get('orders.status');
        statusCallback!(statusUpdate);

        expect(mockServer.to).toHaveBeenCalledWith('user:account-456');
        expect(mockServer.emit).toHaveBeenCalledWith('order-status-update', statusUpdate);
      });
    });

    describe('Order Error Broadcasting', () => {
      it('should broadcast order error to user room when accountId exists', () => {
        const errorNotification: OrderErrorDto = {
          orderId: 'order-123',
          accountId: 'account-456',
          errorCode: 'INSUFFICIENT_LIQUIDITY',
          message: 'Not enough liquidity to match order',
          timestamp: new Date().toISOString(),
        };

        const errorCallback = natsCallbacks.get('orders.error');
        expect(errorCallback).toBeDefined();
        errorCallback!(errorNotification);

        expect(mockServer.to).toHaveBeenCalledWith('user:account-456');
        expect(mockServer.emit).toHaveBeenCalledWith('order-error', errorNotification);
      });

      it('should not broadcast order error when accountId is missing', () => {
        const errorNotification: OrderErrorDto = {
          errorCode: 'INTERNAL_ERROR',
          message: 'Internal server error',
          timestamp: new Date().toISOString(),
        };

        const errorCallback = natsCallbacks.get('orders.error');
        errorCallback!(errorNotification);

        // Should not call server.to or emit when no accountId
        expect(mockServer.to).not.toHaveBeenCalled();
        expect(mockServer.emit).not.toHaveBeenCalled();
      });

      it('should handle validation errors', () => {
        const errorNotification: OrderErrorDto = {
          orderId: 'order-123',
          accountId: 'account-456',
          errorCode: 'VALIDATION_ERROR',
          message: 'Invalid order data',
          timestamp: new Date().toISOString(),
        };

        const errorCallback = natsCallbacks.get('orders.error');
        errorCallback!(errorNotification);

        expect(mockServer.to).toHaveBeenCalledWith('user:account-456');
        expect(mockServer.emit).toHaveBeenCalledWith('order-error', errorNotification);
      });
    });
  });

  describe('Multiple Rooms Management', () => {
    beforeEach(async () => {
      await gateway.afterInit(mockServer);
    });

    it('should handle multiple orderbook subscriptions', () => {
      gateway.handleSubscribeOrderbook(mockClient, {
        loanToken: 'USDC',
        maturity: 1234567890,
      });

      gateway.handleSubscribeOrderbook(mockClient, {
        loanToken: 'DAI',
        maturity: 9876543210,
      });

      expect(mockClient.join).toHaveBeenCalledTimes(2);
      expect(mockClient.join).toHaveBeenCalledWith('orderbook:USDC:1234567890');
      expect(mockClient.join).toHaveBeenCalledWith('orderbook:DAI:9876543210');
    });

    it('should broadcast to correct rooms for different tokens', () => {
      const snapshot1: OrderBookSnapshotDto = {
        loanToken: 'USDC',
        maturity: 1234567890,
        lendOrders: [],
        borrowOrders: [],
        timestamp: new Date().toISOString(),
      };

      const snapshot2: OrderBookSnapshotDto = {
        loanToken: 'DAI',
        maturity: 9876543210,
        lendOrders: [],
        borrowOrders: [],
        timestamp: new Date().toISOString(),
      };

      const orderbookCallback = natsCallbacks.get('orderbook.snapshot');

      orderbookCallback!(snapshot1);
      expect(mockServer.to).toHaveBeenCalledWith('orderbook:USDC:1234567890');

      orderbookCallback!(snapshot2);
      expect(mockServer.to).toHaveBeenCalledWith('orderbook:DAI:9876543210');
    });
  });

  describe('Cache Management', () => {
    beforeEach(async () => {
      await gateway.afterInit(mockServer);
    });

    it('should maintain separate cache entries for different orderbooks', () => {
      const snapshot1: OrderBookSnapshotDto = {
        loanToken: 'USDC',
        maturity: 1234567890,
        lendOrders: [],
        borrowOrders: [],
        timestamp: '2026-01-01T00:00:00Z',
      };

      const snapshot2: OrderBookSnapshotDto = {
        loanToken: 'DAI',
        maturity: 9876543210,
        lendOrders: [],
        borrowOrders: [],
        timestamp: '2026-01-02T00:00:00Z',
      };

      const orderbookCallback = natsCallbacks.get('orderbook.snapshot');

      orderbookCallback!(snapshot1);
      orderbookCallback!(snapshot2);

      // Subscribe to first orderbook
      gateway.handleSubscribeOrderbook(mockClient, {
        loanToken: 'USDC',
        maturity: 1234567890,
      });
      expect(mockClient.emit).toHaveBeenCalledWith('orderbook-update', snapshot1);

      // Subscribe to second orderbook
      mockClient.emit.mockClear();
      gateway.handleSubscribeOrderbook(mockClient, {
        loanToken: 'DAI',
        maturity: 9876543210,
      });
      expect(mockClient.emit).toHaveBeenCalledWith('orderbook-update', snapshot2);
    });

    it('should update cache when new snapshot arrives', () => {
      const oldSnapshot: OrderBookSnapshotDto = {
        loanToken: 'USDC',
        maturity: 1234567890,
        lendOrders: [],
        borrowOrders: [],
        timestamp: '2026-01-01T00:00:00Z',
      };

      const newSnapshot: OrderBookSnapshotDto = {
        loanToken: 'USDC',
        maturity: 1234567890,
        lendOrders: [
          {
            id: 'order-1',
            accountId: 'account-1',
            assetId: 'asset-1',
            side: 'LEND' as any,
            type: 'LIMIT' as any,
            rate: 500,
            quantity: '1000',
            filledQuantity: '0',
            settlementFee: '10',
            status: OrderStatus.Open,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        borrowOrders: [],
        timestamp: '2026-01-02T00:00:00Z',
      };

      const orderbookCallback = natsCallbacks.get('orderbook.snapshot');

      // First snapshot
      orderbookCallback!(oldSnapshot);

      // Second snapshot (should update cache)
      orderbookCallback!(newSnapshot);

      // Subscribe and verify we get the latest snapshot
      gateway.handleSubscribeOrderbook(mockClient, {
        loanToken: 'USDC',
        maturity: 1234567890,
      });
      expect(mockClient.emit).toHaveBeenCalledWith('orderbook-update', newSnapshot);
    });
  });

  describe('Error Handling', () => {
    it('should handle NATS subscription failures gracefully', async () => {
      const errorNatsService = {
        subscribe: jest.fn().mockRejectedValue(new Error('NATS connection failed')),
      } as any;

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          EventsGateway,
          {
            provide: NatsService,
            useValue: errorNatsService,
          },
        ],
      }).compile();

      const errorGateway = module.get<EventsGateway>(EventsGateway);
      errorGateway.server = mockServer;

      // Should not throw - afterInit is void so we just call it
      expect(() => errorGateway.afterInit(mockServer)).not.toThrow();
    });
  });
});
