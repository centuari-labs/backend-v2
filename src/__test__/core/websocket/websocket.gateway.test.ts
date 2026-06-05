import { Test, TestingModule } from "@nestjs/testing";
import { Server, Socket } from "socket.io";
import { EventsGateway } from "../../../core/websocket/websocket.gateway";
import { NatsService } from "../../../core/nats/nats.service";
import { OrderRepository } from "../../../orders/repositories/order.repository";
import { PrivyAuthStrategy } from "../../../common/guards/strategies/privy-auth.strategy";
import {
    OrderSide,
    OrderStatus,
    OrderType,
} from "../../../orders/constants/order.constants";

const TEST_ASSET_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const TEST_ASSET_ID_2 = "b2c3d4e5-f6a7-8901-bcde-f12345678901";
const TEST_WALLET = "0xcA2E021f8FEA9E3fb5F86A68A3158315404e6157";

describe("EventsGateway", () => {
    let gateway: EventsGateway;
    let natsService: jest.Mocked<NatsService>;
    let mockServer: jest.Mocked<Server>;
    let mockClient: jest.Mocked<Socket>;
    let mockOrderRepository: jest.Mocked<
        Pick<
            OrderRepository,
            | "findActiveLimitOrdersForOrderbook"
            | "findOrderForTracking"
            | "findActiveOrderIdsByAsset"
        >
    >;

    // Mock callback storage for NATS subscriptions
    const natsCallbacks = new Map<
        string,
        (data: any, subject: string) => void | Promise<void>
    >();

    beforeEach(async () => {
        natsCallbacks.clear();

        const mockNatsService = {
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
            publish: jest.fn().mockResolvedValue(undefined),
            isConnected: jest.fn().mockReturnValue(true),
            getConnection: jest.fn().mockReturnValue({}),
        };

        mockOrderRepository = {
            findActiveLimitOrdersForOrderbook: jest.fn().mockResolvedValue([]),
            findOrderForTracking: jest.fn().mockResolvedValue(null),
            // Return all common test order IDs as valid by default.
            // Individual tests can override this mock when needed.
            findActiveOrderIdsByAsset: jest
                .fn()
                .mockResolvedValue([
                    "order-001",
                    "order-002",
                    "order-003",
                    "order-e2e-1",
                ]),
        };

        mockServer = {
            to: jest.fn().mockReturnThis(),
            emit: jest.fn(),
        } as any;

        mockClient = {
            id: "test-client-id",
            join: jest.fn(),
            leave: jest.fn(),
            emit: jest.fn(),
            // Authenticated socket: the verified wallet lives on `data`.
            data: {},
            handshake: { auth: {}, headers: {} },
        } as any;

        const mockPrivyAuthStrategy = {
            validate: jest.fn(),
            getName: jest.fn().mockReturnValue("privy"),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                EventsGateway,
                {
                    provide: NatsService,
                    useValue: mockNatsService,
                },
                {
                    provide: OrderRepository,
                    useValue: mockOrderRepository,
                },
                {
                    provide: PrivyAuthStrategy,
                    useValue: mockPrivyAuthStrategy,
                },
            ],
        }).compile();

        gateway = module.get<EventsGateway>(EventsGateway);
        natsService = module.get(NatsService) as jest.Mocked<NatsService>;
        gateway.server = mockServer;
    });

    afterEach(() => {
        gateway.onModuleDestroy();
    });

    /** Helper to create a flat order creation message (matches actual NATS payload) */
    function createOrderMessage(overrides: Record<string, any> = {}) {
        return {
            orderId: "order-001",
            walletAddress: TEST_WALLET,
            assetId: TEST_ASSET_ID,
            markets: [{ marketId: "market-001", maturity: 1704067200 }],
            side: OrderSide.Lend,
            type: OrderType.Limit,
            status: OrderStatus.Open,
            originalAmount: "1000000",
            remainingAmount: "1000000",
            settlementFeeAmount: "100",
            rate: 500,
            ...overrides,
        };
    }

    describe("Gateway Initialization", () => {
        it("should be defined", () => {
            expect(gateway).toBeDefined();
        });

        it("should subscribe to NATS orders.> and matches.> on initialization", async () => {
            await gateway.afterInit(mockServer);

            expect(natsService.subscribe).toHaveBeenCalledTimes(2);
            expect(natsService.subscribe).toHaveBeenCalledWith(
                "orders.>",
                expect.any(Function),
            );
            expect(natsService.subscribe).toHaveBeenCalledWith(
                "matches.>",
                expect.any(Function),
            );
        });
    });

    describe("Client Connection Lifecycle", () => {
        it("should handle client connection", () => {
            expect(() => gateway.handleConnection(mockClient)).not.toThrow();
        });

        it("should handle client disconnection", () => {
            expect(() => gateway.handleDisconnect(mockClient)).not.toThrow();
        });
    });

    describe("Orderbook Subscription", () => {
        beforeEach(async () => {
            await gateway.afterInit(mockServer);
        });

        it("should allow client to subscribe to orderbook room", async () => {
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

        it("should allow client to unsubscribe from orderbook room", () => {
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

        it("should send cached orderbook when client subscribes", async () => {
            const ordersCallback = natsCallbacks.get("orders.>");
            ordersCallback!(createOrderMessage(), "orders.lend.limit");
            await new Promise((r) => setTimeout(r, 10));

            await gateway.handleSubscribeOrderbook(mockClient, {
                assetId: TEST_ASSET_ID,
            });

            expect(mockClient.emit).toHaveBeenCalledWith("orderbook-update", {
                assetId: TEST_ASSET_ID,
                lend: [{ rate: 5, amount: "1000000", orders: 1 }],
                borrow: [],
                timestamp: expect.any(Number),
            });
        });

        it("should call repository when loading orders from DB", async () => {
            mockOrderRepository.findActiveLimitOrdersForOrderbook.mockResolvedValue(
                [],
            );

            await gateway.handleSubscribeOrderbook(mockClient, {
                assetId: TEST_ASSET_ID,
            });

            expect(
                mockOrderRepository.findActiveLimitOrdersForOrderbook,
            ).toHaveBeenCalledWith(TEST_ASSET_ID);
        });
    });

    describe("User Position Subscriptions", () => {
        it("should allow an authenticated client to join its OWN active-positions room", () => {
            mockClient.data.walletAddress = "account-123";

            const result = gateway.handleActivePosition(mockClient, {
                accountId: "account-123",
            });

            expect(mockClient.join).toHaveBeenCalledWith("user:account-123");
            expect(result).toEqual({
                success: true,
                room: "user:account-123",
            });
        });

        it("should allow an authenticated client to join its OWN open-positions room", () => {
            mockClient.data.walletAddress = "account-123";

            const result = gateway.handleOpenPosition(mockClient, {
                accountId: "account-123",
            });

            expect(mockClient.join).toHaveBeenCalledWith("user:account-123");
            expect(result).toEqual({
                success: true,
                room: "user:account-123",
            });
        });

        it("rejects joining ANOTHER user's room (BOLA)", () => {
            mockClient.data.walletAddress = "account-123";

            const result = gateway.handleActivePosition(mockClient, {
                accountId: "account-999",
            });

            expect(mockClient.join).not.toHaveBeenCalled();
            expect(result).toEqual({ success: false, error: "forbidden" });
        });

        it("rejects joining a user room when unauthenticated", () => {
            mockClient.data = {};

            const result = gateway.handleOpenPosition(mockClient, {
                accountId: "account-123",
            });

            expect(mockClient.join).not.toHaveBeenCalled();
            expect(result).toEqual({
                success: false,
                error: "unauthenticated",
            });
        });
    });

    describe("NATS Event Broadcasting", () => {
        beforeEach(async () => {
            await gateway.afterInit(mockServer);
        });

        describe("Order Creation", () => {
            it("should broadcast orderbook update when lend limit order created", async () => {
                const ordersCallback = natsCallbacks.get("orders.>");
                ordersCallback!(createOrderMessage(), "orders.lend.limit");
                await new Promise((r) => setTimeout(r, 10));

                expect(mockServer.to).toHaveBeenCalledWith(
                    `orderbook:${TEST_ASSET_ID}`,
                );
                expect(mockServer.emit).toHaveBeenCalledWith(
                    "orderbook-update",
                    {
                        assetId: TEST_ASSET_ID,
                        lend: [{ rate: 5, amount: "1000000", orders: 1 }],
                        borrow: [],
                        timestamp: expect.any(Number),
                    },
                );
            });

            it("should broadcast orderbook update when borrow limit order created", async () => {
                const ordersCallback = natsCallbacks.get("orders.>");
                ordersCallback!(
                    createOrderMessage({
                        orderId: "order-002",
                        side: OrderSide.Borrow,
                        type: OrderType.Limit,
                        rate: 750,
                        remainingAmount: "500000",
                        originalAmount: "500000",
                    }),
                    "orders.borrow.limit",
                );
                await new Promise((r) => setTimeout(r, 10));

                expect(mockServer.emit).toHaveBeenCalledWith(
                    "orderbook-update",
                    {
                        assetId: TEST_ASSET_ID,
                        lend: [],
                        borrow: [{ rate: 7.5, amount: "500000", orders: 1 }],
                        timestamp: expect.any(Number),
                    },
                );
            });

            it("should aggregate multiple orders at the same rate", async () => {
                const ordersCallback = natsCallbacks.get("orders.>");

                ordersCallback!(
                    createOrderMessage({
                        orderId: "order-001",
                        rate: 500,
                        remainingAmount: "1000000",
                        originalAmount: "1000000",
                    }),
                    "orders.lend.limit",
                );
                await new Promise((r) => setTimeout(r, 10));

                ordersCallback!(
                    createOrderMessage({
                        orderId: "order-002",
                        walletAddress:
                            "0xAb9A004468A39cCC07e1f62B59F990f45304a222",
                        rate: 500,
                        remainingAmount: "2000000",
                        originalAmount: "2000000",
                    }),
                    "orders.lend.limit",
                );
                await new Promise((r) => setTimeout(r, 10));

                const emitCalls = (mockServer.emit as jest.Mock).mock.calls;
                const orderbookCalls = emitCalls.filter(
                    (c) => c[0] === "orderbook-update",
                );
                const lastOrderbook = orderbookCalls[orderbookCalls.length - 1];
                expect(lastOrderbook[1].lend).toEqual([
                    { rate: 5, amount: "3000000", orders: 2 },
                ]);
            });

            it("should show multiple lend rate levels sorted descending", async () => {
                const ordersCallback = natsCallbacks.get("orders.>");

                ordersCallback!(
                    createOrderMessage({
                        orderId: "order-001",
                        rate: 800,
                        remainingAmount: "1000000",
                        originalAmount: "1000000",
                    }),
                    "orders.lend.limit",
                );
                await new Promise((r) => setTimeout(r, 10));

                ordersCallback!(
                    createOrderMessage({
                        orderId: "order-002",
                        rate: 500,
                        remainingAmount: "2000000",
                        originalAmount: "2000000",
                    }),
                    "orders.lend.limit",
                );
                await new Promise((r) => setTimeout(r, 10));

                const emitCalls = (mockServer.emit as jest.Mock).mock.calls;
                const orderbookCalls = emitCalls.filter(
                    (c) => c[0] === "orderbook-update",
                );
                const lastOrderbook = orderbookCalls[orderbookCalls.length - 1];
                expect(lastOrderbook[1].lend).toEqual([
                    { rate: 5, amount: "2000000", orders: 1 },
                    { rate: 8, amount: "1000000", orders: 1 },
                ]);
            });

            it("should emit open-positions to user room for limit orders", async () => {
                const ordersCallback = natsCallbacks.get("orders.>");
                ordersCallback!(createOrderMessage(), "orders.lend.limit");
                await new Promise((r) => setTimeout(r, 10));

                // accountId in the gateway is set from walletAddress
                expect(mockServer.to).toHaveBeenCalledWith(
                    `user:${TEST_WALLET}`,
                );
                expect(mockServer.emit).toHaveBeenCalledWith(
                    "open-positions",
                    expect.objectContaining({
                        order: expect.objectContaining({
                            orderId: "order-001",
                        }),
                        subject: "orders.lend.limit",
                    }),
                );
            });

            it("should not emit open-positions for market orders", async () => {
                const ordersCallback = natsCallbacks.get("orders.>");
                ordersCallback!(
                    createOrderMessage({
                        orderId: "order-001",
                        type: OrderType.Market,
                        status: OrderStatus.Open,
                        rate: undefined,
                    }),
                    "orders.lend.market",
                );
                await new Promise((r) => setTimeout(r, 10));

                const emitCalls = (mockServer.emit as jest.Mock).mock.calls;
                const openPositionCalls = emitCalls.filter(
                    (c) => c[0] === "open-positions",
                );
                expect(openPositionCalls).toHaveLength(0);
            });

            it("should exclude market orders from orderbook", async () => {
                const ordersCallback = natsCallbacks.get("orders.>");
                ordersCallback!(
                    createOrderMessage({
                        orderId: "order-001",
                        type: OrderType.Market,
                        rate: undefined,
                        remainingAmount: "500000",
                        originalAmount: "500000",
                    }),
                    "orders.lend.market",
                );
                await new Promise((r) => setTimeout(r, 10));

                const emitCalls = (mockServer.emit as jest.Mock).mock.calls;
                const orderbookCall = emitCalls.find(
                    (c) => c[0] === "orderbook-update",
                );
                expect(orderbookCall[1].lend).toEqual([]);
            });
        });

        describe("Status Update Broadcasting", () => {
            it("should update orderbook when order is partially filled", async () => {
                const ordersCallback = natsCallbacks.get("orders.>");

                // Create an order
                ordersCallback!(
                    createOrderMessage({
                        orderId: "order-001",
                        rate: 500,
                        remainingAmount: "1000000",
                        originalAmount: "1000000",
                    }),
                    "orders.lend.limit",
                );

                mockServer.to = jest.fn().mockReturnThis();
                (mockServer.emit as jest.Mock).mockClear();

                // Status update: partially filled (async via handleStatusUpdate)
                ordersCallback!(
                    {
                        orderId: "order-001",
                        status: "PARTIALLY_FILLED",
                        remainingAmount: "600000",
                        timestamp: Date.now(),
                    },
                    "orders.status",
                );

                // Wait for the async handleStatusUpdate to complete
                await new Promise((r) => setTimeout(r, 10));

                expect(mockServer.to).toHaveBeenCalledWith(
                    `orderbook:${TEST_ASSET_ID}`,
                );
                const emitCalls = (mockServer.emit as jest.Mock).mock.calls;
                const orderbookCall = emitCalls.find(
                    (c) => c[0] === "orderbook-update",
                );
                expect(orderbookCall[1].lend).toEqual([
                    { rate: 5, amount: "600000", orders: 1 },
                ]);
            });

            it("should remove order from orderbook when filled", async () => {
                const ordersCallback = natsCallbacks.get("orders.>");

                ordersCallback!(
                    createOrderMessage({
                        orderId: "order-001",
                        rate: 500,
                        remainingAmount: "1000000",
                        originalAmount: "1000000",
                    }),
                    "orders.lend.limit",
                );
                await new Promise((r) => setTimeout(r, 10));

                (mockServer.emit as jest.Mock).mockClear();
                mockServer.to = jest.fn().mockReturnThis();

                ordersCallback!(
                    {
                        orderId: "order-001",
                        status: "FILLED",
                        remainingAmount: "0",
                        timestamp: Date.now(),
                    },
                    "orders.status",
                );

                await new Promise((r) => setTimeout(r, 10));

                const emitCalls = (mockServer.emit as jest.Mock).mock.calls;
                const orderbookCall = emitCalls.find(
                    (c) => c[0] === "orderbook-update",
                );
                expect(orderbookCall[1].lend).toEqual([]);
            });

            it("should emit active-positions to user room when order filled", async () => {
                const ordersCallback = natsCallbacks.get("orders.>");

                ordersCallback!(
                    createOrderMessage({ orderId: "order-001" }),
                    "orders.lend.limit",
                );

                (mockServer.emit as jest.Mock).mockClear();
                mockServer.to = jest.fn().mockReturnThis();

                ordersCallback!(
                    {
                        orderId: "order-001",
                        status: "FILLED",
                        remainingAmount: "0",
                        timestamp: Date.now(),
                    },
                    "orders.status",
                );

                await new Promise((r) => setTimeout(r, 10));

                expect(mockServer.to).toHaveBeenCalledWith(
                    `user:${TEST_WALLET}`,
                );
                const emitCalls = (mockServer.emit as jest.Mock).mock.calls;
                const activeCall = emitCalls.find(
                    (c) => c[0] === "active-positions",
                );
                expect(activeCall).toBeDefined();
                expect(activeCall[1].order.orderId).toBe("order-001");
            });

            it("should emit open-positions when partially filled limit order", async () => {
                const ordersCallback = natsCallbacks.get("orders.>");

                ordersCallback!(
                    createOrderMessage({
                        orderId: "order-001",
                        type: OrderType.Limit,
                    }),
                    "orders.lend.limit",
                );

                (mockServer.emit as jest.Mock).mockClear();
                mockServer.to = jest.fn().mockReturnThis();

                ordersCallback!(
                    {
                        orderId: "order-001",
                        status: "PARTIALLY_FILLED",
                        remainingAmount: "600000",
                        timestamp: Date.now(),
                    },
                    "orders.status",
                );

                await new Promise((r) => setTimeout(r, 10));

                const emitCalls = (mockServer.emit as jest.Mock).mock.calls;
                const openCall = emitCalls.find(
                    (c) => c[0] === "open-positions",
                );
                expect(openCall).toBeDefined();
                expect(openCall[1].order.orderId).toBe("order-001");
                expect(openCall[1].order.status).toBe("PARTIALLY_FILLED");
            });

            it("should try loading from repository for unknown orders", async () => {
                const ordersCallback = natsCallbacks.get("orders.>");
                mockOrderRepository.findOrderForTracking.mockResolvedValue(
                    null,
                );

                ordersCallback!(
                    {
                        orderId: "unknown-order",
                        status: "FILLED",
                        remainingAmount: "0",
                        timestamp: Date.now(),
                    },
                    "orders.status",
                );

                await new Promise((r) => setTimeout(r, 10));

                expect(
                    mockOrderRepository.findOrderForTracking,
                ).toHaveBeenCalledWith("unknown-order");
                expect(mockServer.to).not.toHaveBeenCalled();
            });

            it("should eagerly remove filled orders from orderState", async () => {
                const ordersCallback = natsCallbacks.get("orders.>");

                ordersCallback!(
                    createOrderMessage({
                        orderId: "order-001",
                        rate: 500,
                        remainingAmount: "1000000",
                        originalAmount: "1000000",
                    }),
                    "orders.lend.limit",
                );
                await new Promise((r) => setTimeout(r, 10));

                ordersCallback!(
                    {
                        orderId: "order-001",
                        status: "FILLED",
                        remainingAmount: "0",
                        timestamp: Date.now(),
                    },
                    "orders.status",
                );
                await new Promise((r) => setTimeout(r, 10));

                // Create another order for the same asset — filled order should not reappear
                (mockServer.emit as jest.Mock).mockClear();
                mockServer.to = jest.fn().mockReturnThis();

                ordersCallback!(
                    createOrderMessage({
                        orderId: "order-002",
                        rate: 600,
                        remainingAmount: "500000",
                        originalAmount: "500000",
                    }),
                    "orders.lend.limit",
                );
                await new Promise((r) => setTimeout(r, 10));

                const emitCalls = (mockServer.emit as jest.Mock).mock.calls;
                const orderbookCall = emitCalls.find(
                    (c) => c[0] === "orderbook-update",
                );
                // Only order-002 should be in the orderbook, order-001 was removed
                expect(orderbookCall[1].lend).toEqual([
                    { rate: 6, amount: "500000", orders: 1 },
                ]);
            });
        });

        describe("Cancel Broadcasting", () => {
            it("should remove order from orderbook when cancelled", async () => {
                const ordersCallback = natsCallbacks.get("orders.>");

                ordersCallback!(
                    createOrderMessage({
                        orderId: "order-001",
                        rate: 500,
                        remainingAmount: "1000000",
                        originalAmount: "1000000",
                    }),
                    "orders.lend.limit",
                );
                await new Promise((r) => setTimeout(r, 10));

                (mockServer.emit as jest.Mock).mockClear();
                mockServer.to = jest.fn().mockReturnThis();

                ordersCallback!(
                    {
                        orderId: "order-001",
                        walletAddress: TEST_WALLET,
                    },
                    "orders.cancel",
                );
                await new Promise((r) => setTimeout(r, 10));

                const emitCalls = (mockServer.emit as jest.Mock).mock.calls;
                const orderbookCall = emitCalls.find(
                    (c) => c[0] === "orderbook-update",
                );
                expect(orderbookCall[1].lend).toEqual([]);
            });

            it("should eagerly remove cancelled orders from orderState", async () => {
                const ordersCallback = natsCallbacks.get("orders.>");

                ordersCallback!(
                    createOrderMessage({
                        orderId: "order-001",
                        rate: 500,
                        remainingAmount: "1000000",
                        originalAmount: "1000000",
                    }),
                    "orders.lend.limit",
                );
                await new Promise((r) => setTimeout(r, 10));

                ordersCallback!(
                    {
                        orderId: "order-001",
                        walletAddress: TEST_WALLET,
                    },
                    "orders.cancel",
                );
                await new Promise((r) => setTimeout(r, 10));

                // Create another order — cancelled order should not reappear
                (mockServer.emit as jest.Mock).mockClear();
                mockServer.to = jest.fn().mockReturnThis();

                ordersCallback!(
                    createOrderMessage({
                        orderId: "order-002",
                        rate: 600,
                        remainingAmount: "500000",
                        originalAmount: "500000",
                    }),
                    "orders.lend.limit",
                );
                await new Promise((r) => setTimeout(r, 10));

                const emitCalls = (mockServer.emit as jest.Mock).mock.calls;
                const orderbookCall = emitCalls.find(
                    (c) => c[0] === "orderbook-update",
                );
                expect(orderbookCall[1].lend).toEqual([
                    { rate: 6, amount: "500000", orders: 1 },
                ]);
            });

            it("should ignore cancel for unknown orders", () => {
                const ordersCallback = natsCallbacks.get("orders.>");

                ordersCallback!(
                    {
                        orderId: "unknown-order",
                        walletAddress: TEST_WALLET,
                    },
                    "orders.cancel",
                );

                expect(mockServer.to).not.toHaveBeenCalled();
            });
        });
    });

    describe("Multiple Rooms Management", () => {
        beforeEach(async () => {
            await gateway.afterInit(mockServer);
        });

        it("should handle multiple orderbook subscriptions", async () => {
            await gateway.handleSubscribeOrderbook(mockClient, {
                assetId: TEST_ASSET_ID,
            });

            await gateway.handleSubscribeOrderbook(mockClient, {
                assetId: TEST_ASSET_ID_2,
            });

            expect(mockClient.join).toHaveBeenCalledTimes(2);
            expect(mockClient.join).toHaveBeenCalledWith(
                `orderbook:${TEST_ASSET_ID}`,
            );
            expect(mockClient.join).toHaveBeenCalledWith(
                `orderbook:${TEST_ASSET_ID_2}`,
            );
        });

        it("should maintain separate orderbooks for different assets", async () => {
            const ordersCallback = natsCallbacks.get("orders.>");

            ordersCallback!(
                createOrderMessage({
                    orderId: "order-001",
                    assetId: TEST_ASSET_ID,
                    rate: 500,
                    remainingAmount: "1000000",
                    originalAmount: "1000000",
                }),
                "orders.lend.limit",
            );
            await new Promise((r) => setTimeout(r, 10));

            ordersCallback!(
                createOrderMessage({
                    orderId: "order-002",
                    assetId: TEST_ASSET_ID_2,
                    rate: 300,
                    remainingAmount: "2000000",
                    originalAmount: "2000000",
                }),
                "orders.lend.limit",
            );
            await new Promise((r) => setTimeout(r, 10));

            // Subscribe to first asset
            await gateway.handleSubscribeOrderbook(mockClient, {
                assetId: TEST_ASSET_ID,
            });
            expect(mockClient.emit).toHaveBeenCalledWith(
                "orderbook-update",
                expect.objectContaining({
                    assetId: TEST_ASSET_ID,
                    lend: [{ rate: 5, amount: "1000000", orders: 1 }],
                }),
            );

            // Subscribe to second asset
            mockClient.emit.mockClear();
            await gateway.handleSubscribeOrderbook(mockClient, {
                assetId: TEST_ASSET_ID_2,
            });
            expect(mockClient.emit).toHaveBeenCalledWith(
                "orderbook-update",
                expect.objectContaining({
                    assetId: TEST_ASSET_ID_2,
                    lend: [{ rate: 3, amount: "2000000", orders: 1 }],
                }),
            );
        });

        it("should broadcast to correct rooms for different assets", async () => {
            const ordersCallback = natsCallbacks.get("orders.>");

            ordersCallback!(
                createOrderMessage({
                    orderId: "order-001",
                    assetId: TEST_ASSET_ID,
                }),
                "orders.lend.limit",
            );
            await new Promise((r) => setTimeout(r, 10));
            expect(mockServer.to).toHaveBeenCalledWith(
                `orderbook:${TEST_ASSET_ID}`,
            );

            ordersCallback!(
                createOrderMessage({
                    orderId: "order-002",
                    assetId: TEST_ASSET_ID_2,
                }),
                "orders.lend.limit",
            );
            await new Promise((r) => setTimeout(r, 10));
            expect(mockServer.to).toHaveBeenCalledWith(
                `orderbook:${TEST_ASSET_ID_2}`,
            );
        });
    });

    describe("Error Handling", () => {
        it("should handle NATS subscription failures gracefully", async () => {
            const errorNatsService = {
                subscribe: jest
                    .fn()
                    .mockRejectedValue(new Error("NATS connection failed")),
                isConnected: jest.fn().mockReturnValue(true),
            } as any;

            const module: TestingModule = await Test.createTestingModule({
                providers: [
                    EventsGateway,
                    {
                        provide: NatsService,
                        useValue: errorNatsService,
                    },
                    {
                        provide: OrderRepository,
                        useValue: mockOrderRepository,
                    },
                    {
                        provide: PrivyAuthStrategy,
                        useValue: { validate: jest.fn() },
                    },
                ],
            }).compile();

            const errorGateway = module.get<EventsGateway>(EventsGateway);
            errorGateway.server = mockServer;

            // afterInit returns a promise that catches errors internally
            await expect(
                errorGateway.afterInit(mockServer),
            ).resolves.not.toThrow();

            errorGateway.onModuleDestroy();
        });

        it("should handle malformed NATS messages gracefully", async () => {
            await gateway.afterInit(mockServer);
            const ordersCallback = natsCallbacks.get("orders.>");

            // Null data should not throw (caught by try-catch)
            expect(() =>
                ordersCallback!(null, "orders.lend.limit"),
            ).not.toThrow();

            // Empty object for status update — unknown order, no crash
            expect(() => ordersCallback!({}, "orders.status")).not.toThrow();
        });
    });

    describe("Active IDs Cache", () => {
        beforeEach(async () => {
            await gateway.afterInit(mockServer);
        });

        it("should cache fetchActiveOrderIds results", async () => {
            mockOrderRepository.findActiveOrderIdsByAsset.mockResolvedValue([
                "order-001",
            ]);

            const ordersCallback = natsCallbacks.get("orders.>");

            // Create two orders for the same asset — triggers two aggregateAndBroadcast calls
            ordersCallback!(
                createOrderMessage({ orderId: "order-001" }),
                "orders.lend.limit",
            );
            await new Promise((r) => setTimeout(r, 10));

            ordersCallback!(
                createOrderMessage({ orderId: "order-002" }),
                "orders.lend.limit",
            );
            await new Promise((r) => setTimeout(r, 10));

            // Repository should only be called once due to caching
            expect(
                mockOrderRepository.findActiveOrderIdsByAsset,
            ).toHaveBeenCalledTimes(1);
        });
    });
});
