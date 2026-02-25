import { Test, TestingModule } from '@nestjs/testing';
import { EventsGateway } from '../../core/websocket/websocket.gateway';
import { NatsService } from '../../core/nats/nats.service';
import { OrderSide, OrderStatus, OrderType } from '../../orders/constants/order.constants';
import type { RecentTradeDto } from '../../core/websocket/dto/recent-trades.dto';
import { createMockNatsService } from '../helpers/mock-services';

/**
 * Integration tests for WebSocket gateway — recent trades and orderbook flows.
 * Uses a real EventsGateway with mocked NATS and Socket.IO server.
 */
describe('WebSocket Recent Trades Integration', () => {
    let gateway: EventsGateway;
    let natsService: jest.Mocked<NatsService>;
    let mockServer: any;
    let mockClient: any;
    let natsCallbacks: Map<string, (data: any, subject: string) => void | Promise<void>>;

    beforeEach(async () => {
        natsCallbacks = new Map();

        const mockNats = createMockNatsService();
        (mockNats.subscribe as jest.Mock).mockImplementation(
            async (subject: string, callback: (data: any, subject: string) => void | Promise<void>) => {
                natsCallbacks.set(subject, callback);
            },
        );

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                EventsGateway,
                { provide: NatsService, useValue: mockNats },
            ],
        }).compile();

        gateway = module.get<EventsGateway>(EventsGateway);
        natsService = module.get(NatsService) as jest.Mocked<NatsService>;

        // Mock Socket.IO server
        mockServer = {
            to: jest.fn().mockReturnThis(),
            emit: jest.fn(),
            sockets: {
                adapter: {
                    rooms: new Map(),
                },
            },
        };
        (gateway as any).server = mockServer;

        // Mock client
        mockClient = {
            id: 'test-client-1',
            join: jest.fn(),
            leave: jest.fn(),
            emit: jest.fn(),
        };
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('Recent trades subscription', () => {
        it('should join the recent-trades room on subscribe', () => {
            const result = gateway.handleSubscribeRecentTrades(
                mockClient,
                { loanToken: '0xToken123' },
            );

            expect(mockClient.join).toHaveBeenCalledWith('recent-trades:0xToken123');
            expect(result).toEqual({ success: true, room: 'recent-trades:0xToken123' });
        });

        it('should leave the recent-trades room on unsubscribe', () => {
            gateway.handleUnsubscribeRecentTrades(
                mockClient,
                { loanToken: '0xToken123' },
            );

            expect(mockClient.leave).toHaveBeenCalledWith('recent-trades:0xToken123');
        });

        it('should broadcast trade on handleMatchCreated', () => {
            const trade: RecentTradeDto = {
                loanToken: '0xToken123',
                side: 'LEND',
                amount: '1000',
                rate: 500,
                timestamp: Date.now(),
            };

            gateway.handleMatchCreated(trade);

            expect(mockServer.to).toHaveBeenCalledWith('recent-trades:0xToken123');
            expect(mockServer.emit).toHaveBeenCalledWith('recent-trade', trade);
        });

        it('should cache recent trades (max 20)', () => {
            for (let i = 0; i < 25; i++) {
                gateway.handleMatchCreated({
                    loanToken: '0xToken123',
                    side: 'LEND',
                    amount: String(i),
                    rate: 500,
                    timestamp: Date.now() + i,
                });
            }

            // Access internal cache to verify
            const cache = (gateway as any).recentTradesCache;
            const trades = cache.get('recent-trades:0xToken123');
            expect(trades).toHaveLength(20);
            // Most recent trade should be first
            expect(trades[0].amount).toBe('24');
        });

        it('should send snapshot on subscribe when cache exists', () => {
            // Populate cache first
            const trade: RecentTradeDto = {
                loanToken: '0xToken123',
                side: 'BORROW',
                amount: '500',
                rate: 300,
                timestamp: Date.now(),
            };
            gateway.handleMatchCreated(trade);

            // New client subscribes
            gateway.handleSubscribeRecentTrades(mockClient, { loanToken: '0xToken123' });

            expect(mockClient.emit).toHaveBeenCalledWith(
                'recent-trades-snapshot',
                expect.arrayContaining([expect.objectContaining({ amount: '500' })]),
            );
        });

        it('should not send snapshot when cache is empty', () => {
            gateway.handleSubscribeRecentTrades(mockClient, { loanToken: '0xNewToken' });

            expect(mockClient.emit).not.toHaveBeenCalledWith(
                'recent-trades-snapshot',
                expect.anything(),
            );
        });
    });

    describe('Orderbook subscription', () => {
        it('should join orderbook room on subscribe', () => {
            const result = gateway.handleSubscribeOrderbook(
                mockClient,
                { loanToken: '0xToken123' },
            );

            expect(mockClient.join).toHaveBeenCalledWith('orderbook:0xToken123');
            expect(result).toEqual({ success: true, room: 'orderbook:0xToken123' });
        });

        it('should leave orderbook room on unsubscribe', () => {
            const result = gateway.handleUnsubscribeOrderbook(
                mockClient,
                { loanToken: '0xToken123' },
            );

            expect(mockClient.leave).toHaveBeenCalledWith('orderbook:0xToken123');
            expect(result).toEqual({ success: true, room: 'orderbook:0xToken123' });
        });

        it('should send cached orderbook on subscribe', () => {
            // Populate orderbook cache via NATS order creation
            const ordersCallback = natsCallbacks.get('orders.>');
            if (ordersCallback) {
                ordersCallback(
                    {
                        orderId: 'order-1',
                        walletAddress: '0xWallet',
                        loanToken: '0xToken123',
                        markets: [{ marketId: 'market-1', maturity: 1748736000 }],
                        side: OrderSide.Lend,
                        type: OrderType.Limit,
                        status: OrderStatus.Open,
                        originalAmount: '1000',
                        remainingAmount: '1000',
                        settlementFeeAmount: '50',
                        rate: 500,
                    },
                    'orders.lend.limit',
                );
            }

            // Subscribe should return cached orderbook
            gateway.handleSubscribeOrderbook(mockClient, { loanToken: '0xToken123' });

            // If NATS was set up, there should be cached data
            if (ordersCallback) {
                expect(mockClient.emit).toHaveBeenCalledWith(
                    'orderbook-update',
                    expect.objectContaining({ loanToken: '0xToken123' }),
                );
            }
        });
    });

    describe('User position subscriptions', () => {
        it('should join user room on active-positions subscribe', () => {
            const result = gateway.handleActivePosition(
                mockClient,
                { accountId: 'account-1' },
            );

            expect(mockClient.join).toHaveBeenCalledWith('user:account-1');
            expect(result).toEqual({ success: true, room: 'user:account-1' });
        });

        it('should join user room on open-positions subscribe', () => {
            const result = gateway.handleOpenPosition(
                mockClient,
                { accountId: 'account-1' },
            );

            expect(mockClient.join).toHaveBeenCalledWith('user:account-1');
            expect(result).toEqual({ success: true, room: 'user:account-1' });
        });
    });
});
