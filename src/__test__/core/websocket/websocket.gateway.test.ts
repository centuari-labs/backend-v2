import { Test, TestingModule } from "@nestjs/testing";
import { Server, Socket } from "socket.io";
import { EventsGateway } from "../../../core/websocket/websocket.gateway";
import { NatsService } from "../../../core/nats/nats.service";
import {
    OrderSide,
    OrderStatus,
    OrderType,
} from "../../../orders/constants/order.constants";

describe("EventsGateway", () => {
    let gateway: EventsGateway;
    let natsService: jest.Mocked<NatsService>;
    let mockServer: jest.Mocked<Server>;
    let mockClient: jest.Mocked<Socket>;

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

        mockServer = {
            to: jest.fn().mockReturnThis(),
            emit: jest.fn(),
        } as any;

        mockClient = {
            id: "test-client-id",
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

    /** Helper to create a mock order creation envelope */
    function createOrderEnvelope(
        overrides: { data?: Record<string, any>; [key: string]: any } = {},
    ) {
        const { data: dataOverrides, ...topOverrides } = overrides;
        return {
            event: "orders.lend.limit",
            timestamp: new Date().toISOString(),
            data: {
                orderId: "order-001",
                walletAddress:
                    "0xcA2E021f8FEA9E3fb5F86A68A3158315404e6157",
                loanToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
                markets: [{ marketId: "market-001", maturity: 1704067200 }],
                side: OrderSide.Lend,
                type: OrderType.Limit,
                status: OrderStatus.Open,
                originalAmount: "1000000",
                remainingAmount: "1000000",
                settlementFeeAmount: "100",
                rate: 500,
                ...dataOverrides,
            },
            accountId: "account-001",
            ...topOverrides,
        };
    }

    describe("Gateway Initialization", () => {
        it("should be defined", () => {
            expect(gateway).toBeDefined();
        });

        it("should subscribe to NATS orders.> on initialization", async () => {
            await gateway.afterInit(mockServer);

            expect(natsService.subscribe).toHaveBeenCalledTimes(1);
            expect(natsService.subscribe).toHaveBeenCalledWith(
                "orders.>",
                expect.any(Function),
            );
        });
    });

    describe("Client Connection Lifecycle", () => {
        it("should handle client connection", () => {
            expect(() => gateway.handleConnection(mockClient)).not.toThrow();
        });

        it("should handle client disconnection", () => {
            expect(() =>
                gateway.handleDisconnect(mockClient),
            ).not.toThrow();
        });
    });

    describe("Orderbook Subscription", () => {
        beforeEach(async () => {
            await gateway.afterInit(mockServer);
        });

        it("should allow client to subscribe to orderbook room", () => {
            const result = gateway.handleSubscribeOrderbook(mockClient, {
                loanToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
            });

            expect(mockClient.join).toHaveBeenCalledWith(
                "orderbook:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
            );
            expect(result).toEqual({
                success: true,
                room: "orderbook:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
            });
        });

        it("should allow client to unsubscribe from orderbook room", () => {
            const result = gateway.handleUnsubscribeOrderbook(mockClient, {
                loanToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
            });

            expect(mockClient.leave).toHaveBeenCalledWith(
                "orderbook:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
            );
            expect(result).toEqual({
                success: true,
                room: "orderbook:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
            });
        });

        it("should send cached orderbook when client subscribes", () => {
            const ordersCallback = natsCallbacks.get("orders.>");
            ordersCallback!(
                createOrderEnvelope(),
                "orders.lend.limit",
            );

            gateway.handleSubscribeOrderbook(mockClient, {
                loanToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
            });

            expect(mockClient.emit).toHaveBeenCalledWith(
                "orderbook-update",
                {
                    loanToken:
                        "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
                    lend: [{ rate: 5, amount: "1000000", orders: 1 }],
                    borrow: [],
                    timestamp: expect.any(Number),
                },
            );
        });

        it("should not send cached snapshot if none exists", () => {
            gateway.handleSubscribeOrderbook(mockClient, {
                loanToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
            });

            expect(mockClient.emit).not.toHaveBeenCalled();
        });
    });

    describe("User Position Subscriptions", () => {
        it("should allow client to subscribe to active-positions", () => {
            const result = gateway.handleActivePosition(mockClient, {
                accountId: "account-123",
            });

            expect(mockClient.join).toHaveBeenCalledWith(
                "user:account-123",
            );
            expect(result).toEqual({
                success: true,
                room: "user:account-123",
            });
        });

        it("should allow client to subscribe to open-positions", () => {
            const result = gateway.handleOpenPosition(mockClient, {
                accountId: "account-123",
            });

            expect(mockClient.join).toHaveBeenCalledWith(
                "user:account-123",
            );
            expect(result).toEqual({
                success: true,
                room: "user:account-123",
            });
        });
    });

    describe("NATS Event Broadcasting", () => {
        beforeEach(async () => {
            await gateway.afterInit(mockServer);
        });

        describe("Order Creation", () => {
            it("should broadcast orderbook update when lend limit order created", () => {
                const ordersCallback = natsCallbacks.get("orders.>");
                ordersCallback!(
                    createOrderEnvelope(),
                    "orders.lend.limit",
                );

                expect(mockServer.to).toHaveBeenCalledWith(
                    "orderbook:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
                );
                expect(mockServer.emit).toHaveBeenCalledWith(
                    "orderbook-update",
                    {
                        loanToken:
                            "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
                        lend: [
                            { rate: 5, amount: "1000000", orders: 1 },
                        ],
                        borrow: [],
                        timestamp: expect.any(Number),
                    },
                );
            });

            it("should broadcast orderbook update when borrow limit order created", () => {
                const ordersCallback = natsCallbacks.get("orders.>");
                ordersCallback!(
                    createOrderEnvelope({
                        data: {
                            orderId: "order-002",
                            side: OrderSide.Borrow,
                            type: OrderType.Limit,
                            rate: 750,
                            remainingAmount: "500000",
                            originalAmount: "500000",
                        },
                    }),
                    "orders.borrow.limit",
                );

                expect(mockServer.emit).toHaveBeenCalledWith(
                    "orderbook-update",
                    {
                        loanToken:
                            "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
                        lend: [],
                        borrow: [
                            { rate: 7.5, amount: "500000", orders: 1 },
                        ],
                        timestamp: expect.any(Number),
                    },
                );
            });

            it("should aggregate multiple orders at the same rate", () => {
                const ordersCallback = natsCallbacks.get("orders.>");

                ordersCallback!(
                    createOrderEnvelope({
                        data: {
                            orderId: "order-001",
                            rate: 500,
                            remainingAmount: "1000000",
                            originalAmount: "1000000",
                        },
                    }),
                    "orders.lend.limit",
                );

                ordersCallback!(
                    createOrderEnvelope({
                        data: {
                            orderId: "order-002",
                            rate: 500,
                            remainingAmount: "2000000",
                            originalAmount: "2000000",
                        },
                        accountId: "account-002",
                    }),
                    "orders.lend.limit",
                );

                const emitCalls = (mockServer.emit as jest.Mock).mock
                    .calls;
                const orderbookCalls = emitCalls.filter(
                    (c) => c[0] === "orderbook-update",
                );
                const lastOrderbook =
                    orderbookCalls[orderbookCalls.length - 1];
                expect(lastOrderbook[1].lend).toEqual([
                    { rate: 5, amount: "3000000", orders: 2 },
                ]);
            });

            it("should show multiple rate levels sorted ascending", () => {
                const ordersCallback = natsCallbacks.get("orders.>");

                ordersCallback!(
                    createOrderEnvelope({
                        data: {
                            orderId: "order-001",
                            rate: 800,
                            remainingAmount: "1000000",
                            originalAmount: "1000000",
                        },
                    }),
                    "orders.lend.limit",
                );

                ordersCallback!(
                    createOrderEnvelope({
                        data: {
                            orderId: "order-002",
                            rate: 500,
                            remainingAmount: "2000000",
                            originalAmount: "2000000",
                        },
                    }),
                    "orders.lend.limit",
                );

                const emitCalls = (mockServer.emit as jest.Mock).mock
                    .calls;
                const orderbookCalls = emitCalls.filter(
                    (c) => c[0] === "orderbook-update",
                );
                const lastOrderbook =
                    orderbookCalls[orderbookCalls.length - 1];
                expect(lastOrderbook[1].lend).toEqual([
                    { rate: 5, amount: "2000000", orders: 1 },
                    { rate: 8, amount: "1000000", orders: 1 },
                ]);
            });

            it("should emit open-positions to user room for limit orders", () => {
                const ordersCallback = natsCallbacks.get("orders.>");
                ordersCallback!(
                    createOrderEnvelope(),
                    "orders.lend.limit",
                );

                expect(mockServer.to).toHaveBeenCalledWith(
                    "user:account-001",
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

            it("should not emit open-positions for market orders", () => {
                const ordersCallback = natsCallbacks.get("orders.>");
                ordersCallback!(
                    createOrderEnvelope({
                        event: "orders.lend.market",
                        data: {
                            orderId: "order-001",
                            type: OrderType.Market,
                            status: OrderStatus.Open,
                            rate: undefined,
                        },
                    }),
                    "orders.lend.market",
                );

                const emitCalls = (mockServer.emit as jest.Mock).mock
                    .calls;
                const openPositionCalls = emitCalls.filter(
                    (c) => c[0] === "open-positions",
                );
                expect(openPositionCalls).toHaveLength(0);
            });

            it("should include market orders in orderbook at rate 0", () => {
                const ordersCallback = natsCallbacks.get("orders.>");
                ordersCallback!(
                    createOrderEnvelope({
                        data: {
                            orderId: "order-001",
                            type: OrderType.Market,
                            rate: undefined,
                            remainingAmount: "500000",
                            originalAmount: "500000",
                        },
                    }),
                    "orders.lend.market",
                );

                const emitCalls = (mockServer.emit as jest.Mock).mock
                    .calls;
                const orderbookCall = emitCalls.find(
                    (c) => c[0] === "orderbook-update",
                );
                expect(orderbookCall[1].lend).toEqual([
                    { rate: 0, amount: "500000", orders: 1 },
                ]);
            });
        });

        describe("Status Update Broadcasting", () => {
            it("should update orderbook when order is partially filled", () => {
                const ordersCallback = natsCallbacks.get("orders.>");

                // Create an order
                ordersCallback!(
                    createOrderEnvelope({
                        data: {
                            orderId: "order-001",
                            rate: 500,
                            remainingAmount: "1000000",
                            originalAmount: "1000000",
                        },
                    }),
                    "orders.lend.limit",
                );

                mockServer.to = jest.fn().mockReturnThis();
                (mockServer.emit as jest.Mock).mockClear();

                // Status update: partially filled
                ordersCallback!(
                    {
                        orderId: "order-001",
                        status: "PARTIALLY_FILLED",
                        remainingAmount: "600000",
                        timestamp: Date.now(),
                    },
                    "orders.status",
                );

                expect(mockServer.to).toHaveBeenCalledWith(
                    "orderbook:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
                );
                const emitCalls = (mockServer.emit as jest.Mock).mock
                    .calls;
                const orderbookCall = emitCalls.find(
                    (c) => c[0] === "orderbook-update",
                );
                expect(orderbookCall[1].lend).toEqual([
                    { rate: 5, amount: "600000", orders: 1 },
                ]);
            });

            it("should remove order from orderbook when filled", () => {
                const ordersCallback = natsCallbacks.get("orders.>");

                ordersCallback!(
                    createOrderEnvelope({
                        data: {
                            orderId: "order-001",
                            rate: 500,
                            remainingAmount: "1000000",
                            originalAmount: "1000000",
                        },
                    }),
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

                const emitCalls = (mockServer.emit as jest.Mock).mock
                    .calls;
                const orderbookCall = emitCalls.find(
                    (c) => c[0] === "orderbook-update",
                );
                expect(orderbookCall[1].lend).toEqual([]);
            });

            it("should emit active-positions to user room when order filled", () => {
                const ordersCallback = natsCallbacks.get("orders.>");

                ordersCallback!(
                    createOrderEnvelope({
                        data: { orderId: "order-001" },
                    }),
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

                expect(mockServer.to).toHaveBeenCalledWith(
                    "user:account-001",
                );
                const emitCalls = (mockServer.emit as jest.Mock).mock
                    .calls;
                const activeCall = emitCalls.find(
                    (c) => c[0] === "active-positions",
                );
                expect(activeCall).toBeDefined();
                expect(activeCall[1].order.orderId).toBe("order-001");
            });

            it("should emit open-positions when partially filled limit order", () => {
                const ordersCallback = natsCallbacks.get("orders.>");

                ordersCallback!(
                    createOrderEnvelope({
                        data: {
                            orderId: "order-001",
                            type: OrderType.Limit,
                        },
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

                const emitCalls = (mockServer.emit as jest.Mock).mock
                    .calls;
                const openCall = emitCalls.find(
                    (c) => c[0] === "open-positions",
                );
                expect(openCall).toBeDefined();
                expect(openCall[1].order.orderId).toBe("order-001");
                expect(openCall[1].order.status).toBe("PARTIALLY_FILLED");
            });

            it("should ignore status updates for unknown orders", () => {
                const ordersCallback = natsCallbacks.get("orders.>");

                ordersCallback!(
                    {
                        orderId: "unknown-order",
                        status: "FILLED",
                        remainingAmount: "0",
                        timestamp: Date.now(),
                    },
                    "orders.status",
                );

                expect(mockServer.to).not.toHaveBeenCalled();
            });
        });

        describe("Cancel Broadcasting", () => {
            it("should remove order from orderbook when cancelled", () => {
                const ordersCallback = natsCallbacks.get("orders.>");

                ordersCallback!(
                    createOrderEnvelope({
                        data: {
                            orderId: "order-001",
                            rate: 500,
                            remainingAmount: "1000000",
                            originalAmount: "1000000",
                        },
                    }),
                    "orders.lend.limit",
                );

                (mockServer.emit as jest.Mock).mockClear();
                mockServer.to = jest.fn().mockReturnThis();

                ordersCallback!(
                    {
                        event: "orders.cancel",
                        timestamp: new Date().toISOString(),
                        data: {
                            orderId: "order-001",
                            walletAddress:
                                "0xcA2E021f8FEA9E3fb5F86A68A3158315404e6157",
                        },
                    },
                    "orders.cancel",
                );

                const emitCalls = (mockServer.emit as jest.Mock).mock
                    .calls;
                const orderbookCall = emitCalls.find(
                    (c) => c[0] === "orderbook-update",
                );
                expect(orderbookCall[1].lend).toEqual([]);
            });

            it("should ignore cancel for unknown orders", () => {
                const ordersCallback = natsCallbacks.get("orders.>");

                ordersCallback!(
                    {
                        event: "orders.cancel",
                        timestamp: new Date().toISOString(),
                        data: {
                            orderId: "unknown-order",
                            walletAddress:
                                "0xcA2E021f8FEA9E3fb5F86A68A3158315404e6157",
                        },
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

        it("should handle multiple orderbook subscriptions", () => {
            gateway.handleSubscribeOrderbook(mockClient, {
                loanToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
            });

            gateway.handleSubscribeOrderbook(mockClient, {
                loanToken: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
            });

            expect(mockClient.join).toHaveBeenCalledTimes(2);
            expect(mockClient.join).toHaveBeenCalledWith(
                "orderbook:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
            );
            expect(mockClient.join).toHaveBeenCalledWith(
                "orderbook:0x6B175474E89094C44Da98b954EedeAC495271d0F",
            );
        });

        it("should maintain separate orderbooks for different tokens", () => {
            const ordersCallback = natsCallbacks.get("orders.>");

            ordersCallback!(
                createOrderEnvelope({
                    data: {
                        orderId: "order-001",
                        loanToken:
                            "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
                        rate: 500,
                        remainingAmount: "1000000",
                        originalAmount: "1000000",
                    },
                }),
                "orders.lend.limit",
            );

            ordersCallback!(
                createOrderEnvelope({
                    data: {
                        orderId: "order-002",
                        loanToken:
                            "0x6B175474E89094C44Da98b954EedeAC495271d0F",
                        rate: 300,
                        remainingAmount: "2000000",
                        originalAmount: "2000000",
                    },
                }),
                "orders.lend.limit",
            );

            // Subscribe to first token
            gateway.handleSubscribeOrderbook(mockClient, {
                loanToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
            });
            expect(mockClient.emit).toHaveBeenCalledWith(
                "orderbook-update",
                expect.objectContaining({
                    loanToken:
                        "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
                    lend: [{ rate: 5, amount: "1000000", orders: 1 }],
                }),
            );

            // Subscribe to second token
            mockClient.emit.mockClear();
            gateway.handleSubscribeOrderbook(mockClient, {
                loanToken: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
            });
            expect(mockClient.emit).toHaveBeenCalledWith(
                "orderbook-update",
                expect.objectContaining({
                    loanToken:
                        "0x6B175474E89094C44Da98b954EedeAC495271d0F",
                    lend: [{ rate: 3, amount: "2000000", orders: 1 }],
                }),
            );
        });

        it("should broadcast to correct rooms for different tokens", () => {
            const ordersCallback = natsCallbacks.get("orders.>");

            ordersCallback!(
                createOrderEnvelope({
                    data: {
                        orderId: "order-001",
                        loanToken:
                            "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
                    },
                }),
                "orders.lend.limit",
            );
            expect(mockServer.to).toHaveBeenCalledWith(
                "orderbook:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
            );

            ordersCallback!(
                createOrderEnvelope({
                    data: {
                        orderId: "order-002",
                        loanToken:
                            "0x6B175474E89094C44Da98b954EedeAC495271d0F",
                    },
                }),
                "orders.lend.limit",
            );
            expect(mockServer.to).toHaveBeenCalledWith(
                "orderbook:0x6B175474E89094C44Da98b954EedeAC495271d0F",
            );
        });
    });

    describe("Error Handling", () => {
        it("should handle NATS subscription failures gracefully", async () => {
            const errorNatsService = {
                subscribe: jest
                    .fn()
                    .mockRejectedValue(
                        new Error("NATS connection failed"),
                    ),
                isConnected: jest.fn().mockReturnValue(true),
            } as any;

            const module: TestingModule =
                await Test.createTestingModule({
                    providers: [
                        EventsGateway,
                        {
                            provide: NatsService,
                            useValue: errorNatsService,
                        },
                    ],
                }).compile();

            const errorGateway =
                module.get<EventsGateway>(EventsGateway);
            errorGateway.server = mockServer;

            // afterInit returns a promise that catches errors internally
            await expect(
                errorGateway.afterInit(mockServer),
            ).resolves.not.toThrow();
        });

        it("should handle malformed NATS messages gracefully", async () => {
            await gateway.afterInit(mockServer);
            const ordersCallback = natsCallbacks.get("orders.>");

            // Null data should not throw (caught by try-catch)
            expect(() =>
                ordersCallback!(null, "orders.lend.limit"),
            ).not.toThrow();

            // Empty object for status update — unknown order, no crash
            expect(() =>
                ordersCallback!({}, "orders.status"),
            ).not.toThrow();
        });
    });
});
