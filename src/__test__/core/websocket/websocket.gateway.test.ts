import { Test, TestingModule } from '@nestjs/testing';
import { Server, Socket } from 'socket.io';
import { EventsGateway } from '../../../core/websocket/websocket.gateway';
import { NatsService } from '../../../core/nats/nats.service';

describe('EventsGateway', () => {
  let gateway: EventsGateway;
  let natsService: jest.Mocked<NatsService>;
  let mockServer: jest.Mocked<Server>;
  let mockClient: jest.Mocked<Socket>;

  // Mock callback storage for NATS subscriptions
  const natsCallbacks = new Map<string, (data: any, subject: string) => void | Promise<void>>();

  beforeEach(async () => {
    // Reset callbacks before each test
    natsCallbacks.clear();

    // Create mock NATS service
    const mockNatsService = {
      subscribe: jest.fn().mockImplementation(async (subject: string, callback: (data: any, subject: string) => void | Promise<void>) => {
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

    it('should subscribe to NATS topics on initialization', async () => {
      await gateway.afterInit(mockServer);

      expect(natsService.subscribe).toHaveBeenCalledTimes(2);
      expect(natsService.subscribe).toHaveBeenCalledWith('orders.>', expect.any(Function));
      expect(natsService.subscribe).toHaveBeenCalledWith('orderbook.snapshot', expect.any(Function));
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
      const subscribeData = { assetId: '550e8400-e29b-41d4-a716-446655440001', marketId: '550e8400-e29b-41d4-a716-446655440010' };
      const result = gateway.handleSubscribeOrderbook(mockClient, subscribeData);

      expect(mockClient.join).toHaveBeenCalledWith('orderbook:550e8400-e29b-41d4-a716-446655440001:550e8400-e29b-41d4-a716-446655440010');
      expect(result).toEqual({
        success: true,
        room: 'orderbook:550e8400-e29b-41d4-a716-446655440001:550e8400-e29b-41d4-a716-446655440010',
      });
    });

    it('should allow client to unsubscribe from orderbook room', () => {
      const unsubscribeData = { assetId: '550e8400-e29b-41d4-a716-446655440001', marketId: '550e8400-e29b-41d4-a716-446655440010' };
      const result = gateway.handleUnsubscribeOrderbook(mockClient, unsubscribeData);

      expect(mockClient.leave).toHaveBeenCalledWith('orderbook:550e8400-e29b-41d4-a716-446655440001:550e8400-e29b-41d4-a716-446655440010');
      expect(result).toEqual({
        success: true,
        room: 'orderbook:550e8400-e29b-41d4-a716-446655440001:550e8400-e29b-41d4-a716-446655440010',
      });
    });

    it('should send cached snapshot when client subscribes', () => {
      // Simulate an orderbook snapshot arriving from NATS (price in basis points)
      const natsSnapshot = {
        assetId: '550e8400-e29b-41d4-a716-446655440001',
        marketId: '550e8400-e29b-41d4-a716-446655440010',
        lend: { price: 500, apr: '-', amount: '1000000' },
        borrow: null,
        timestamp: 1704067200000,
      };

      const orderbookCallback = natsCallbacks.get('orderbook.snapshot');
      expect(orderbookCallback).toBeDefined();
      orderbookCallback!(natsSnapshot, 'orderbook.snapshot');

      // Now subscribe a client
      const subscribeData = { assetId: '550e8400-e29b-41d4-a716-446655440001', marketId: '550e8400-e29b-41d4-a716-446655440010' };
      gateway.handleSubscribeOrderbook(mockClient, subscribeData);

      // Should emit cached snapshot with price converted to percentage (500 bp = 5%)
      expect(mockClient.emit).toHaveBeenCalledWith('orderbook-update', {
        assetId: '550e8400-e29b-41d4-a716-446655440001',
        marketId: '550e8400-e29b-41d4-a716-446655440010',
        lend: { price: 5, apr: '-', amount: '1000000' },
        borrow: null,
        timestamp: 1704067200000,
      });
    });

    it('should not send cached snapshot if none exists', () => {
      const subscribeData = { assetId: '550e8400-e29b-41d4-a716-446655440001', marketId: '550e8400-e29b-41d4-a716-446655440099' };
      gateway.handleSubscribeOrderbook(mockClient, subscribeData);

      expect(mockClient.emit).not.toHaveBeenCalled();
    });
  });

  describe('User Position Subscriptions', () => {
    it('should allow client to subscribe to active-positions', () => {
      const subscribeData = { accountId: 'account-123' };
      const result = gateway.handleActivePosition(mockClient, subscribeData);

      expect(mockClient.join).toHaveBeenCalledWith('user:account-123');
      expect(result).toEqual({
        success: true,
        room: 'user:account-123',
      });
    });

    it('should allow client to subscribe to open-positions', () => {
      const subscribeData = { accountId: 'account-123' };
      const result = gateway.handleOpenPosition(mockClient, subscribeData);

      expect(mockClient.join).toHaveBeenCalledWith('user:account-123');
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
      it('should broadcast transformed orderbook snapshot to appropriate room', () => {
        const natsSnapshot = {
          assetId: '550e8400-e29b-41d4-a716-446655440001',
          marketId: '550e8400-e29b-41d4-a716-446655440010',
          lend: { price: 500, apr: '-', amount: '1000000' },
          borrow: { price: 750, apr: '-', amount: '500000' },
          timestamp: 1704067200000,
        };

        const orderbookCallback = natsCallbacks.get('orderbook.snapshot');
        expect(orderbookCallback).toBeDefined();
        orderbookCallback!(natsSnapshot, 'orderbook.snapshot');

        expect(mockServer.to).toHaveBeenCalledWith('orderbook:550e8400-e29b-41d4-a716-446655440001:550e8400-e29b-41d4-a716-446655440010');
        expect(mockServer.emit).toHaveBeenCalledWith('orderbook-update', {
          assetId: '550e8400-e29b-41d4-a716-446655440001',
          marketId: '550e8400-e29b-41d4-a716-446655440010',
          lend: { price: 5, apr: '-', amount: '1000000' },
          borrow: { price: 7.5, apr: '-', amount: '500000' },
          timestamp: 1704067200000,
        });
      });

      it('should handle null sides in snapshot', () => {
        const natsSnapshot = {
          assetId: '550e8400-e29b-41d4-a716-446655440001',
          marketId: '550e8400-e29b-41d4-a716-446655440010',
          lend: null,
          borrow: null,
          timestamp: 1704067200000,
        };

        const orderbookCallback = natsCallbacks.get('orderbook.snapshot');
        orderbookCallback!(natsSnapshot, 'orderbook.snapshot');

        expect(mockServer.to).toHaveBeenCalledWith('orderbook:550e8400-e29b-41d4-a716-446655440001:550e8400-e29b-41d4-a716-446655440010');
        expect(mockServer.emit).toHaveBeenCalledWith('orderbook-update', {
          assetId: '550e8400-e29b-41d4-a716-446655440001',
          marketId: '550e8400-e29b-41d4-a716-446655440010',
          lend: null,
          borrow: null,
          timestamp: 1704067200000,
        });
      });

      it('should update cache when new snapshot arrives', () => {
        const oldSnapshot = {
          assetId: '550e8400-e29b-41d4-a716-446655440001',
          marketId: '550e8400-e29b-41d4-a716-446655440010',
          lend: { price: 500, apr: '-', amount: '1000000' },
          borrow: null,
          timestamp: 1704067200000,
        };

        const newSnapshot = {
          assetId: '550e8400-e29b-41d4-a716-446655440001',
          marketId: '550e8400-e29b-41d4-a716-446655440010',
          lend: { price: 600, apr: '-', amount: '2000000' },
          borrow: { price: 800, apr: '-', amount: '500000' },
          timestamp: 1704067300000,
        };

        const orderbookCallback = natsCallbacks.get('orderbook.snapshot');
        orderbookCallback!(oldSnapshot, 'orderbook.snapshot');
        orderbookCallback!(newSnapshot, 'orderbook.snapshot');

        // Subscribe and verify we get the latest snapshot
        gateway.handleSubscribeOrderbook(mockClient, {
          assetId: '550e8400-e29b-41d4-a716-446655440001',
          marketId: '550e8400-e29b-41d4-a716-446655440010',
        });
        expect(mockClient.emit).toHaveBeenCalledWith('orderbook-update', {
          assetId: '550e8400-e29b-41d4-a716-446655440001',
          marketId: '550e8400-e29b-41d4-a716-446655440010',
          lend: { price: 6, apr: '-', amount: '2000000' },
          borrow: { price: 8, apr: '-', amount: '500000' },
          timestamp: 1704067300000,
        });
      });
    });
  });

  describe('Multiple Rooms Management', () => {
    beforeEach(async () => {
      await gateway.afterInit(mockServer);
    });

    it('should handle multiple orderbook subscriptions', () => {
      gateway.handleSubscribeOrderbook(mockClient, {
        assetId: '550e8400-e29b-41d4-a716-446655440001',
        marketId: '550e8400-e29b-41d4-a716-446655440010',
      });

      gateway.handleSubscribeOrderbook(mockClient, {
        assetId: '550e8400-e29b-41d4-a716-446655440002',
        marketId: '550e8400-e29b-41d4-a716-446655440020',
      });

      expect(mockClient.join).toHaveBeenCalledTimes(2);
      expect(mockClient.join).toHaveBeenCalledWith('orderbook:550e8400-e29b-41d4-a716-446655440001:550e8400-e29b-41d4-a716-446655440010');
      expect(mockClient.join).toHaveBeenCalledWith('orderbook:550e8400-e29b-41d4-a716-446655440002:550e8400-e29b-41d4-a716-446655440020');
    });

    it('should broadcast to correct rooms for different tokens', () => {
      const snapshot1 = {
        assetId: '550e8400-e29b-41d4-a716-446655440001',
        marketId: '550e8400-e29b-41d4-a716-446655440010',
        lend: null,
        borrow: null,
        timestamp: 1704067200000,
      };

      const snapshot2 = {
        assetId: '550e8400-e29b-41d4-a716-446655440002',
        marketId: '550e8400-e29b-41d4-a716-446655440020',
        lend: null,
        borrow: null,
        timestamp: 1704067200000,
      };

      const orderbookCallback = natsCallbacks.get('orderbook.snapshot');

      orderbookCallback!(snapshot1, 'orderbook.snapshot');
      expect(mockServer.to).toHaveBeenCalledWith('orderbook:550e8400-e29b-41d4-a716-446655440001:550e8400-e29b-41d4-a716-446655440010');

      orderbookCallback!(snapshot2, 'orderbook.snapshot');
      expect(mockServer.to).toHaveBeenCalledWith('orderbook:550e8400-e29b-41d4-a716-446655440002:550e8400-e29b-41d4-a716-446655440020');
    });
  });

  describe('Cache Management', () => {
    beforeEach(async () => {
      await gateway.afterInit(mockServer);
    });

    it('should maintain separate cache entries for different orderbooks', () => {
      const snapshot1 = {
        assetId: '550e8400-e29b-41d4-a716-446655440001',
        marketId: '550e8400-e29b-41d4-a716-446655440010',
        lend: { price: 500, apr: '-', amount: '1000000' },
        borrow: null,
        timestamp: 1704067200000,
      };

      const snapshot2 = {
        assetId: '550e8400-e29b-41d4-a716-446655440002',
        marketId: '550e8400-e29b-41d4-a716-446655440020',
        lend: null,
        borrow: { price: 300, apr: '-', amount: '2000000' },
        timestamp: 1704067300000,
      };

      const orderbookCallback = natsCallbacks.get('orderbook.snapshot');

      orderbookCallback!(snapshot1, 'orderbook.snapshot');
      orderbookCallback!(snapshot2, 'orderbook.snapshot');

      // Subscribe to first orderbook
      gateway.handleSubscribeOrderbook(mockClient, {
        assetId: '550e8400-e29b-41d4-a716-446655440001',
        marketId: '550e8400-e29b-41d4-a716-446655440010',
      });
      expect(mockClient.emit).toHaveBeenCalledWith('orderbook-update', {
        assetId: '550e8400-e29b-41d4-a716-446655440001',
        marketId: '550e8400-e29b-41d4-a716-446655440010',
        lend: { price: 5, apr: '-', amount: '1000000' },
        borrow: null,
        timestamp: 1704067200000,
      });

      // Subscribe to second orderbook
      mockClient.emit.mockClear();
      gateway.handleSubscribeOrderbook(mockClient, {
        assetId: '550e8400-e29b-41d4-a716-446655440002',
        marketId: '550e8400-e29b-41d4-a716-446655440020',
      });
      expect(mockClient.emit).toHaveBeenCalledWith('orderbook-update', {
        assetId: '550e8400-e29b-41d4-a716-446655440002',
        marketId: '550e8400-e29b-41d4-a716-446655440020',
        lend: null,
        borrow: { price: 3, apr: '-', amount: '2000000' },
        timestamp: 1704067300000,
      });
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

      // Should not throw
      expect(() => errorGateway.afterInit(mockServer)).not.toThrow();
    });
  });
});
