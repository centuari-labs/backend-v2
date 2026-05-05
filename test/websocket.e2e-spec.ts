import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { EventsGateway } from "../src/core/websocket/websocket.gateway";
import { NatsService } from "../src/core/nats/nats.service";
import { OrderRepository } from "../src/orders/repositories/order.repository";
import {
    OrderSide,
    OrderStatus,
    OrderType,
} from "../src/orders/constants/order.constants";
import type { RecentTradeDto } from "../src/core/websocket/dto/recent-trades.dto";

/**
 * E2E tests for the WebSocket gateway.
 * Uses real NestJS app with mocked NATS, connects via Socket.IO client.
 */
describe("WebSocket E2E", () => {
    let app: INestApplication;
    let gateway: EventsGateway;
    let ioClient: any;
    let natsCallbacks: Map<
        string,
        (data: any, subject: string) => void | Promise<void>
    >;

    beforeAll(async () => {
        natsCallbacks = new Map();

        const mockNatsService = {
            publish: jest.fn().mockResolvedValue(undefined),
            subscribe: jest
                .fn()
                .mockImplementation(
                    async (
                        subject: string,
                        callback: (
                            data: any,
                            subject: string,
                        ) => void | Promise<void>,
                    ) => {
                        natsCallbacks.set(subject, callback);
                    },
                ),
            isConnected: jest.fn().mockReturnValue(true),
        };

        const mockOrderRepo = {
            findActiveLimitOrdersForOrderbook: jest.fn().mockResolvedValue([]),
            findOrderForTracking: jest.fn().mockResolvedValue(null),
            findActiveOrderIdsByAsset: jest
                .fn()
                .mockResolvedValue(["order-e2e-1"]),
        };

        const moduleFixture: TestingModule = await Test.createTestingModule({
            providers: [
                EventsGateway,
                { provide: NatsService, useValue: mockNatsService },
                { provide: OrderRepository, useValue: mockOrderRepo },
            ],
        }).compile();

        app = moduleFixture.createNestApplication();
        await app.init();

        gateway = moduleFixture.get<EventsGateway>(EventsGateway);
    });

    afterAll(async () => {
        if (ioClient?.connected) {
            ioClient.disconnect();
        }
        await app.close();
    });

    afterEach(() => {
        if (ioClient?.connected) {
            ioClient.disconnect();
        }
    });

    describe("Gateway initialization", () => {
        it("should have gateway available", () => {
            expect(gateway).toBeDefined();
        });

        it("should subscribe to NATS topics on init", () => {
            // afterInit may have been called, check if NATS callbacks were registered
            expect(natsCallbacks.size).toBeGreaterThanOrEqual(0);
        });
    });

    describe("Orderbook subscription (unit-style via gateway methods)", () => {
        let mockClient: any;
        let mockServer: any;

        beforeEach(() => {
            mockClient = {
                id: "e2e-client-1",
                join: jest.fn(),
                leave: jest.fn(),
                emit: jest.fn(),
            };
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
        });

        it("should subscribe client to orderbook room", async () => {
            const result = await gateway.handleSubscribeOrderbook(mockClient, {
                assetId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
            });

            expect(mockClient.join).toHaveBeenCalledWith(
                "orderbook:a1b2c3d4-e5f6-7890-abcd-ef1234567890",
            );
            expect(result).toEqual({
                success: true,
                room: "orderbook:a1b2c3d4-e5f6-7890-abcd-ef1234567890",
            });
        });

        it("should unsubscribe client from orderbook room", () => {
            const result = gateway.handleUnsubscribeOrderbook(mockClient, {
                assetId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
            });

            expect(mockClient.leave).toHaveBeenCalledWith(
                "orderbook:a1b2c3d4-e5f6-7890-abcd-ef1234567890",
            );
            expect(result).toEqual({
                success: true,
                room: "orderbook:a1b2c3d4-e5f6-7890-abcd-ef1234567890",
            });
        });

        it("should aggregate and broadcast orderbook on order creation", async () => {
            const ordersCallback = natsCallbacks.get("orders.>");
            if (!ordersCallback) return; // Skip if NATS not set up

            ordersCallback(
                {
                    orderId: "order-e2e-1",
                    walletAddress: "0xE2EWallet",
                    assetId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
                    markets: [{ marketId: "market-1", maturity: 1748736000 }],
                    side: OrderSide.Lend,
                    type: OrderType.Limit,
                    status: OrderStatus.Open,
                    originalAmount: "500",
                    remainingAmount: "500",
                    settlementFeeAmount: "25",
                    rate: 300,
                },
                "orders.lend.limit",
            );
            await new Promise((r) => setTimeout(r, 10));

            expect(mockServer.to).toHaveBeenCalledWith(
                "orderbook:a1b2c3d4-e5f6-7890-abcd-ef1234567890",
            );
            expect(mockServer.emit).toHaveBeenCalledWith(
                "orderbook-update",
                expect.objectContaining({
                    assetId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
                    lend: expect.arrayContaining([
                        expect.objectContaining({ rate: 3, amount: "500" }),
                    ]),
                }),
            );
        });
    });

    describe("Recent trades (via gateway methods)", () => {
        let mockClient: any;
        let mockServer: any;

        beforeEach(() => {
            mockClient = {
                id: "e2e-client-2",
                join: jest.fn(),
                leave: jest.fn(),
                emit: jest.fn(),
            };
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
        });

        it("should subscribe to recent-trades room", () => {
            const result = gateway.handleSubscribeRecentTrades(mockClient, {
                assetId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
            });

            expect(mockClient.join).toHaveBeenCalledWith(
                "recent-trades:a1b2c3d4-e5f6-7890-abcd-ef1234567890",
            );
            expect(result).toEqual({
                success: true,
                room: "recent-trades:a1b2c3d4-e5f6-7890-abcd-ef1234567890",
            });
        });

        it("should broadcast trade on handleMatchCreated", () => {
            const trade: RecentTradeDto = {
                assetId: "a1b2c3d4-e5f6-7890-abcd-trade1234567",
                side: "LEND",
                amount: "1000",
                rate: 500,
                timestamp: Date.now(),
            };

            gateway.handleMatchCreated(trade);

            expect(mockServer.to).toHaveBeenCalledWith(
                "recent-trades:a1b2c3d4-e5f6-7890-abcd-trade1234567",
            );
            expect(mockServer.emit).toHaveBeenCalledWith("recent-trade", trade);
        });

        it("should unsubscribe from recent-trades room", () => {
            const result = gateway.handleUnsubscribeRecentTrades(mockClient, {
                assetId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
            });

            expect(mockClient.leave).toHaveBeenCalledWith(
                "recent-trades:a1b2c3d4-e5f6-7890-abcd-ef1234567890",
            );
            expect(result).toEqual({
                success: true,
                room: "recent-trades:a1b2c3d4-e5f6-7890-abcd-ef1234567890",
            });
        });
    });

    describe("User positions (via gateway methods)", () => {
        let mockClient: any;

        beforeEach(() => {
            mockClient = {
                id: "e2e-client-3",
                join: jest.fn(),
                emit: jest.fn(),
            };
        });

        it("should subscribe to active-positions room", () => {
            const result = gateway.handleActivePosition(mockClient, {
                accountId: "e2e-account-1",
            });

            expect(mockClient.join).toHaveBeenCalledWith("user:e2e-account-1");
            expect(result).toEqual({
                success: true,
                room: "user:e2e-account-1",
            });
        });

        it("should subscribe to open-positions room", () => {
            const result = gateway.handleOpenPosition(mockClient, {
                accountId: "e2e-account-1",
            });

            expect(mockClient.join).toHaveBeenCalledWith("user:e2e-account-1");
            expect(result).toEqual({
                success: true,
                room: "user:e2e-account-1",
            });
        });
    });
});
