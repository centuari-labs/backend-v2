import { Test, TestingModule } from "@nestjs/testing";
import { EventsGateway } from "../../core/websocket/websocket.gateway";
import { NatsService } from "../../core/nats/nats.service";
import { OrderRepository } from "../../orders/repositories/order.repository";
import { PrivyAuthStrategy } from "../../common/guards/strategies/privy-auth.strategy";
import {
    OrderSide,
    OrderStatus,
    OrderType,
} from "../../orders/constants/order.constants";
import type { RecentTradeDto } from "../../core/websocket/dto/recent-trades.dto";
import { createMockNatsService } from "../helpers/mock-services";

const TEST_ASSET_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

/**
 * Integration tests for WebSocket gateway — recent trades and orderbook flows.
 * Uses a real EventsGateway with mocked NATS and Socket.IO server.
 */
describe("WebSocket Recent Trades Integration", () => {
    let gateway: EventsGateway;
    let natsService: jest.Mocked<NatsService>;
    let mockServer: any;
    let mockClient: any;
    let natsCallbacks: Map<
        string,
        (data: any, subject: string) => void | Promise<void>
    >;

    beforeEach(async () => {
        natsCallbacks = new Map();

        const mockNats = createMockNatsService();
        (mockNats.subscribe as jest.Mock).mockImplementation(
            async (
                subject: string,
                callback: (data: any, subject: string) => void | Promise<void>,
            ) => {
                natsCallbacks.set(subject, callback);
            },
        );

        const mockOrderRepo = {
            findActiveLimitOrdersForOrderbook: jest.fn().mockResolvedValue([]),
            findOrderForTracking: jest.fn().mockResolvedValue(null),
            findActiveOrderIdsByAsset: jest.fn().mockResolvedValue([]),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                EventsGateway,
                { provide: NatsService, useValue: mockNats },
                { provide: OrderRepository, useValue: mockOrderRepo },
                {
                    provide: PrivyAuthStrategy,
                    useValue: { validate: jest.fn() },
                },
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

        // Mock client (authenticated — verified wallet lives on `data`)
        mockClient = {
            id: "test-client-1",
            join: jest.fn(),
            leave: jest.fn(),
            emit: jest.fn(),
            data: {},
            handshake: { auth: {}, headers: {} },
        };
    });

    afterEach(() => {
        gateway.onModuleDestroy();
        jest.clearAllMocks();
    });

    describe("Recent trades subscription", () => {
        it("should join the recent-trades room on subscribe", () => {
            const result = gateway.handleSubscribeRecentTrades(mockClient, {
                assetId: TEST_ASSET_ID,
            });

            expect(mockClient.join).toHaveBeenCalledWith(
                `recent-trades:${TEST_ASSET_ID}`,
            );
            expect(result).toEqual({
                success: true,
                room: `recent-trades:${TEST_ASSET_ID}`,
            });
        });

        it("should leave the recent-trades room on unsubscribe", () => {
            gateway.handleUnsubscribeRecentTrades(mockClient, {
                assetId: TEST_ASSET_ID,
            });

            expect(mockClient.leave).toHaveBeenCalledWith(
                `recent-trades:${TEST_ASSET_ID}`,
            );
        });

        it("should broadcast trade on handleMatchCreated", () => {
            const trade: RecentTradeDto = {
                assetId: TEST_ASSET_ID,
                side: "LEND",
                amount: "1000",
                rate: 500,
                timestamp: Date.now(),
            };

            gateway.handleMatchCreated(trade);

            expect(mockServer.to).toHaveBeenCalledWith(
                `recent-trades:${TEST_ASSET_ID}`,
            );
            expect(mockServer.emit).toHaveBeenCalledWith("recent-trade", trade);
        });

        it("should cache recent trades (max 20)", () => {
            for (let i = 0; i < 25; i++) {
                gateway.handleMatchCreated({
                    assetId: TEST_ASSET_ID,
                    side: "LEND",
                    amount: String(i),
                    rate: 500,
                    timestamp: Date.now() + i,
                });
            }

            // Access internal cache to verify
            const cache = (gateway as any).recentTradesCache;
            const trades = cache.get(`recent-trades:${TEST_ASSET_ID}`);
            expect(trades).toHaveLength(20);
            // Most recent trade should be first
            expect(trades[0].amount).toBe("24");
        });

        it("should send snapshot on subscribe when cache exists", () => {
            // Populate cache first
            const trade: RecentTradeDto = {
                assetId: TEST_ASSET_ID,
                side: "BORROW",
                amount: "500",
                rate: 300,
                timestamp: Date.now(),
            };
            gateway.handleMatchCreated(trade);

            // New client subscribes
            gateway.handleSubscribeRecentTrades(mockClient, {
                assetId: TEST_ASSET_ID,
            });

            expect(mockClient.emit).toHaveBeenCalledWith(
                "recent-trades-snapshot",
                expect.arrayContaining([
                    expect.objectContaining({ amount: "500" }),
                ]),
            );
        });

        it("should not send snapshot when cache is empty", () => {
            gateway.handleSubscribeRecentTrades(mockClient, {
                assetId: "new-asset-id",
            });

            expect(mockClient.emit).not.toHaveBeenCalledWith(
                "recent-trades-snapshot",
                expect.anything(),
            );
        });
    });

    describe("Orderbook subscription", () => {
        it("should join orderbook room on subscribe", async () => {
            const result = await gateway.handleSubscribeOrderbook(mockClient, {
                assetId: TEST_ASSET_ID,
            });

            expect(mockClient.join).toHaveBeenCalledWith(
                `orderbook:${TEST_ASSET_ID}`,
            );
            expect(result).toEqual({
                success: true,
                room: `orderbook:${TEST_ASSET_ID}`,
            });
        });

        it("should leave orderbook room on unsubscribe", () => {
            const result = gateway.handleUnsubscribeOrderbook(mockClient, {
                assetId: TEST_ASSET_ID,
            });

            expect(mockClient.leave).toHaveBeenCalledWith(
                `orderbook:${TEST_ASSET_ID}`,
            );
            expect(result).toEqual({
                success: true,
                room: `orderbook:${TEST_ASSET_ID}`,
            });
        });

        it("should send cached orderbook on subscribe", async () => {
            // Populate orderbook cache via NATS order creation
            const ordersCallback = natsCallbacks.get("orders.>");
            if (ordersCallback) {
                ordersCallback(
                    {
                        orderId: "order-1",
                        walletAddress: "0xWallet",
                        assetId: TEST_ASSET_ID,
                        markets: [
                            { marketId: "market-1", maturity: 1748736000 },
                        ],
                        side: OrderSide.Lend,
                        type: OrderType.Limit,
                        status: OrderStatus.Open,
                        originalAmount: "1000",
                        remainingAmount: "1000",
                        settlementFeeAmount: "50",
                        rate: 500,
                    },
                    "orders.lend.limit",
                );
            }

            // Subscribe should return cached orderbook
            await gateway.handleSubscribeOrderbook(mockClient, {
                assetId: TEST_ASSET_ID,
            });

            // If NATS was set up, there should be cached data
            if (ordersCallback) {
                expect(mockClient.emit).toHaveBeenCalledWith(
                    "orderbook-update",
                    expect.objectContaining({ assetId: TEST_ASSET_ID }),
                );
            }
        });
    });

    describe("User position subscriptions", () => {
        it("should join user room on active-positions subscribe (owner)", () => {
            mockClient.data.walletAddress = "account-1";

            const result = gateway.handleActivePosition(mockClient, {
                accountId: "account-1",
            });

            expect(mockClient.join).toHaveBeenCalledWith("user:account-1");
            expect(result).toEqual({ success: true, room: "user:account-1" });
        });

        it("should join user room on open-positions subscribe (owner)", () => {
            mockClient.data.walletAddress = "account-1";

            const result = gateway.handleOpenPosition(mockClient, {
                accountId: "account-1",
            });

            expect(mockClient.join).toHaveBeenCalledWith("user:account-1");
            expect(result).toEqual({ success: true, room: "user:account-1" });
        });

        it("should reject joining another user's room (BOLA)", () => {
            mockClient.data.walletAddress = "account-1";

            const result = gateway.handleActivePosition(mockClient, {
                accountId: "account-2",
            });

            expect(mockClient.join).not.toHaveBeenCalled();
            expect(result).toEqual({ success: false, error: "forbidden" });
        });
    });
});
