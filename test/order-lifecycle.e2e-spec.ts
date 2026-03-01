/**
 * E2E: Order lifecycle — create → verify shape → cancel → verify cancelled.
 */

jest.mock("../src/core/privy/privy.service", () => ({}));
jest.mock("../src/common/guards/strategies/privy-auth.strategy", () => ({
    PrivyAuthStrategy: class MockPrivyAuthStrategy {
        async validate() {
            return { userId: "mock", walletAddress: "0xMock" };
        }
        getName() {
            return "privy";
        }
    },
}));

import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, HttpStatus } from "@nestjs/common";
import request from "supertest";
import { App } from "supertest/types";
import { ResponseInterceptor } from "../src/common/interceptors/response.interceptor";

import { OrdersController } from "../src/orders/orders.controller";
import { OrdersService } from "../src/orders/orders.service";

import { AuthGuard } from "../src/common/guards/auth.guard";
import { AuthStrategyFactory } from "../src/common/guards/strategies/auth-strategy.factory";
import { DevAuthStrategy } from "../src/common/guards/strategies/dev-auth.strategy";
import { PrivyAuthStrategy } from "../src/common/guards/strategies/privy-auth.strategy";

import {
    OrderSide,
    OrderType,
    OrderStatus,
} from "../src/orders/constants/order.constants";

describe("Order Lifecycle E2E", () => {
    let app: INestApplication<App>;
    let ordersService: jest.Mocked<OrdersService>;

    const devWallet = "0xLifecycleTestWallet";
    const devToken = `DEV_TOKEN_${devWallet}`;
    const mockOrderId = "e0000000-0000-0000-0000-000000000001";
    const mockAssetId = "b0000000-0000-0000-0000-000000000001";
    const mockMarketId = "c0000000-0000-0000-0000-000000000001";

    const buildOrderResponse = (overrides = {}) => ({
        statusCode: HttpStatus.CREATED,
        data: {
            orderId: mockOrderId,
            walletAddress: devWallet,
            assetId: mockAssetId,
            markets: [{ marketId: mockMarketId, maturity: 1748736000 }],
            timestamp: Date.now(),
            side: OrderSide.Lend,
            type: OrderType.Limit,
            status: OrderStatus.Open,
            originalAmount: "1000",
            settlementFeeAmount: "50000",
            autoRollover: false,
            rate: 6.5,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...overrides,
        },
    });

    beforeAll(async () => {
        const originalEnv = process.env.AUTH_MODE;
        process.env.AUTH_MODE = "development";

        const mockOrdersService = {
            createLendMarketOrder: jest.fn(),
            createLendLimitOrder: jest.fn(),
            createBorrowMarketOrder: jest.fn(),
            createBorrowLimitOrder: jest.fn(),
            cancelOrder: jest.fn(),
        };

        const moduleFixture: TestingModule = await Test.createTestingModule({
            controllers: [OrdersController],
            providers: [
                { provide: OrdersService, useValue: mockOrdersService },
                AuthGuard,
                AuthStrategyFactory,
                DevAuthStrategy,
                {
                    provide: PrivyAuthStrategy,
                    useValue: { validate: jest.fn(), getName: () => "privy" },
                },
            ],
        }).compile();

        app = moduleFixture.createNestApplication();
        app.useGlobalInterceptors(new ResponseInterceptor());
        await app.init();

        ordersService = moduleFixture.get(OrdersService);

        process.env.AUTH_MODE = originalEnv;
    });

    afterAll(async () => {
        await app.close();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("create lend limit order", () => {
        it("returns 201 with double-envelope response shape", async () => {
            ordersService.createLendLimitOrder.mockResolvedValue(
                buildOrderResponse() as any,
            );

            const { body } = await request(app.getHttpServer())
                .post("/orders/lend/limit")
                .set("Authorization", `Bearer ${devToken}`)
                .send({
                    assetId: mockAssetId,
                    amount: "1000",
                    marketIds: [mockMarketId],
                    rate: 650,
                })
                .expect(HttpStatus.CREATED);

            // Outer envelope
            expect(body.statusCode).toBe(201);
            // Inner envelope
            expect(body.data.statusCode).toBe(201);
            expect(body.data.data.orderId).toBe(mockOrderId);
            expect(body.data.data.side).toBe("LEND");
            expect(body.data.data.type).toBe("LIMIT");
            expect(body.data.data.status).toBe("OPEN");
            expect(body.data.data.rate).toBe(6.5);
            expect(body.data.data.markets[0].maturity).toBe(1748736000);
        });
    });

    describe("create borrow market order", () => {
        it("returns 201 with borrow/market shape", async () => {
            ordersService.createBorrowMarketOrder.mockResolvedValue(
                buildOrderResponse({
                    side: OrderSide.Borrow,
                    type: OrderType.Market,
                    rate: 0,
                }) as any,
            );

            const { body } = await request(app.getHttpServer())
                .post("/orders/borrow/market")
                .set("Authorization", `Bearer ${devToken}`)
                .send({
                    assetId: mockAssetId,
                    amount: "5000",
                    marketIds: [mockMarketId],
                })
                .expect(HttpStatus.CREATED);

            expect(body.data.data.side).toBe("BORROW");
            expect(body.data.data.type).toBe("MARKET");
            expect(body.data.data.rate).toBe(0);
        });
    });

    describe("cancel order", () => {
        it("returns cancelled order", async () => {
            ordersService.cancelOrder.mockResolvedValue({
                id: mockOrderId,
                status: OrderStatus.Cancelled,
            } as any);

            const { body } = await request(app.getHttpServer())
                .patch(`/orders/${mockOrderId}/cancel`)
                .set("Authorization", `Bearer ${devToken}`)
                .expect(HttpStatus.OK);

            // cancelOrder returns the entity directly (not OrderResponse), so interceptor wraps once
            expect(body.statusCode).toBe(200);
            expect(body.data.status).toBe("CANCELLED");
        });
    });

    describe("full lifecycle: create → cancel → verify", () => {
        it("creates an order then cancels it", async () => {
            // Step 1: Create
            ordersService.createLendLimitOrder.mockResolvedValue(
                buildOrderResponse() as any,
            );

            const createRes = await request(app.getHttpServer())
                .post("/orders/lend/limit")
                .set("Authorization", `Bearer ${devToken}`)
                .send({
                    assetId: mockAssetId,
                    amount: "1000",
                    marketIds: [mockMarketId],
                    rate: 650,
                })
                .expect(HttpStatus.CREATED);

            const createdOrderId = createRes.body.data.data.orderId;
            expect(createdOrderId).toBe(mockOrderId);
            expect(createRes.body.data.data.status).toBe("OPEN");

            // Step 2: Cancel
            ordersService.cancelOrder.mockResolvedValue({
                id: createdOrderId,
                status: OrderStatus.Cancelled,
                side: OrderSide.Lend,
                type: OrderType.Limit,
            } as any);

            const cancelRes = await request(app.getHttpServer())
                .patch(`/orders/${createdOrderId}/cancel`)
                .set("Authorization", `Bearer ${devToken}`)
                .expect(HttpStatus.OK);

            expect(cancelRes.body.data.status).toBe("CANCELLED");
            expect(ordersService.cancelOrder).toHaveBeenCalledWith(
                createdOrderId,
                devWallet,
            );
        });
    });
});
