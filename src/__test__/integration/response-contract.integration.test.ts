/**
 * Integration test: Full HTTP pipeline with real ResponseInterceptor + mocked services.
 *
 * Verifies the exact wire format that the frontend receives for each endpoint.
 */

jest.mock("../../core/privy/privy.service", () => ({}));
jest.mock("../../common/guards/strategies/privy-auth.strategy", () => ({
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
import { ResponseInterceptor } from "src/common/interceptors/response.interceptor";

import { OrdersController } from "src/orders/orders.controller";
import { OrdersService } from "src/orders/orders.service";
import { MarketController } from "src/market/market.controller";
import { MarketService } from "src/market/market.service";
import { PortfolioController } from "src/portfolio/portfolio.controller";
import { PortfolioService } from "src/portfolio/portfolio.service";

import { AuthGuard } from "src/common/guards/auth.guard";
import { AuthStrategyFactory } from "src/common/guards/strategies/auth-strategy.factory";
import { PrivyAuthStrategy } from "src/common/guards/strategies/privy-auth.strategy";

import {
    OrderSide,
    OrderType,
    OrderStatus,
} from "src/orders/constants/order.constants";

describe("Response Contract Integration", () => {
    let app: INestApplication<App>;
    let ordersService: jest.Mocked<OrdersService>;
    let marketService: jest.Mocked<MarketService>;
    let portfolioService: jest.Mocked<PortfolioService>;

    const testToken = "test-privy-jwt";

    beforeAll(async () => {
        const mockOrdersService = {
            createLendMarketOrder: jest.fn(),
            createLendLimitOrder: jest.fn(),
            createBorrowMarketOrder: jest.fn(),
            createBorrowLimitOrder: jest.fn(),
            cancelOrder: jest.fn(),
        };

        const mockMarketService = {
            getMarketSnapshot: jest.fn(),
        };

        const mockPortfolioService = {
            getMyPortfolio: jest.fn(),
            getMyAssets: jest.fn(),
            getLendBorrowAssets: jest.fn(),
            getMyHealthFactor: jest.fn(),
            getMyPosition: jest.fn(),
            setAssetAsCollateral: jest.fn(),
        };

        const moduleFixture: TestingModule = await Test.createTestingModule({
            controllers: [
                OrdersController,
                MarketController,
                PortfolioController,
            ],
            providers: [
                { provide: OrdersService, useValue: mockOrdersService },
                { provide: MarketService, useValue: mockMarketService },
                { provide: PortfolioService, useValue: mockPortfolioService },
                AuthGuard,
                AuthStrategyFactory,
                PrivyAuthStrategy,
            ],
        }).compile();

        app = moduleFixture.createNestApplication();
        app.useGlobalInterceptors(new ResponseInterceptor());
        await app.init();

        ordersService = moduleFixture.get(OrdersService);
        marketService = moduleFixture.get(MarketService);
        portfolioService = moduleFixture.get(PortfolioService);
    });

    afterAll(async () => {
        await app.close();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("POST /orders/lend/limit → double-envelope", () => {
        it("returns { statusCode: 201, data: { statusCode: 201, data: {...} } }", async () => {
            const serviceResponse = {
                statusCode: HttpStatus.CREATED,
                data: {
                    orderId: "d0000000-0000-0000-0000-000000000001",
                    walletAddress: "0xMock",
                    assetId: "b0000000-0000-0000-0000-000000000001",
                    markets: [
                        {
                            marketId: "c0000000-0000-0000-0000-000000000001",
                            maturity: 1748736000,
                        },
                    ],
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
                },
            };
            ordersService.createLendLimitOrder.mockResolvedValue(
                serviceResponse as any,
            );

            const { body } = await request(app.getHttpServer())
                .post("/orders/lend/limit")
                .set("Authorization", `Bearer ${testToken}`)
                .send({
                    assetId: "b0000000-0000-0000-0000-000000000001",
                    amount: "1000",
                    marketIds: ["c0000000-0000-0000-0000-000000000001"],
                    rate: 650,
                })
                .expect(HttpStatus.CREATED);

            // Outer envelope from ResponseInterceptor
            expect(body).toHaveProperty("statusCode", 201);
            expect(body).toHaveProperty("data");

            // Inner envelope from OrderResponse (controller returns { statusCode, data })
            expect(body.data).toHaveProperty("statusCode", 201);
            expect(body.data).toHaveProperty("data");
            expect(body.data.data).toHaveProperty("orderId");
            expect(body.data.data).toHaveProperty("rate", 6.5);
        });

        it("FE unwrap: apiClient gets inner envelope, then .data gets order", async () => {
            const serviceResponse = {
                statusCode: HttpStatus.CREATED,
                data: {
                    orderId: "order-123",
                    walletAddress: "0xMock",
                    assetId: "asset-1",
                    markets: [],
                    timestamp: Date.now(),
                    side: OrderSide.Lend,
                    type: OrderType.Limit,
                    status: OrderStatus.Open,
                    originalAmount: "500",
                    settlementFeeAmount: "25000",
                    autoRollover: false,
                    rate: 5,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            };
            ordersService.createLendLimitOrder.mockResolvedValue(
                serviceResponse as any,
            );

            const { body } = await request(app.getHttpServer())
                .post("/orders/lend/limit")
                .set("Authorization", `Bearer ${testToken}`)
                .send({
                    assetId: "asset-1",
                    amount: "500",
                    marketIds: ["market-1"],
                    rate: 500,
                })
                .expect(HttpStatus.CREATED);

            // Simulate FE: apiClient unwraps outer → body.data
            const afterApiClient = body.data;
            // Then createLendLimitOrder unwraps inner → afterApiClient.data
            const orderData = afterApiClient.data;

            expect(orderData.orderId).toBe("order-123");
            expect(orderData.rate).toBe(5);
        });
    });

    describe("GET /market → standard envelope", () => {
        it("returns { statusCode: 200, data: { total_deposit, active_loans, markets } }", async () => {
            const snapshot = {
                total_deposit: "1500000.00",
                active_loans: "750000.00",
                markets: [
                    {
                        asset: {
                            id: "asset-1",
                            name: "USD Coin",
                            symbol: "USDC",
                            decimals: 6,
                            imageUrl: null,
                        },
                        market: {
                            market_id: "market-1",
                            maturity: 1748736000,
                        },
                        borrow_rate: 10.1,
                        lend_rate: 6.5,
                        collateral_factor: 75,
                    },
                ],
            };
            marketService.getMarketSnapshot.mockResolvedValue(snapshot);

            const { body } = await request(app.getHttpServer())
                .get("/market")
                .expect(HttpStatus.OK);

            expect(body.statusCode).toBe(200);
            expect(body.data).toHaveProperty("total_deposit", "1500000.00");
            expect(body.data).toHaveProperty("active_loans", "750000.00");
            expect(body.data.markets).toHaveLength(1);
            expect(body.data.markets[0].lend_rate).toBe(6.5);
        });
    });

    describe("GET /portfolio/my-assets → paginated envelope", () => {
        it("returns { statusCode: 200, data: [...items], meta: { page, ... } }", async () => {
            const paginatedResponse = {
                data: [
                    {
                        symbol: "USDC",
                        name: "USD Coin",
                        walletBalance: 5000,
                        amountInUsd: 5000,
                        isCollateral: false,
                        imageUrl: null,
                    },
                ],
                page: 1,
                limit: 100,
                totalData: 1,
                totalPages: 1,
            };
            portfolioService.getMyAssets.mockResolvedValue(
                paginatedResponse as any,
            );

            const { body } = await request(app.getHttpServer())
                .get("/portfolio/my-assets?limit=100")
                .set("Authorization", `Bearer ${testToken}`)
                .expect(HttpStatus.OK);

            // ResponseInterceptor extracts paginated response
            expect(body.statusCode).toBe(200);
            expect(Array.isArray(body.data)).toBe(true);
            expect(body.data).toHaveLength(1);
            expect(body.data[0].symbol).toBe("USDC");

            // Pagination in meta
            expect(body.meta).toEqual({
                page: 1,
                limit: 100,
                totalData: 1,
                totalPages: 1,
            });
        });

        it("FE unwrap: apiClient gets flat array (not paginated object)", async () => {
            const paginatedResponse = {
                data: [
                    {
                        symbol: "USDC",
                        name: "USD Coin",
                        walletBalance: 1000,
                        amountInUsd: 1000,
                        isCollateral: false,
                        imageUrl: null,
                    },
                    {
                        symbol: "ETH",
                        name: "Ethereum",
                        walletBalance: 2,
                        amountInUsd: 6000,
                        isCollateral: true,
                        imageUrl: null,
                    },
                ],
                page: 1,
                limit: 100,
                totalData: 2,
                totalPages: 1,
            };
            portfolioService.getMyAssets.mockResolvedValue(
                paginatedResponse as any,
            );

            const { body } = await request(app.getHttpServer())
                .get("/portfolio/my-assets?limit=100")
                .set("Authorization", `Bearer ${testToken}`)
                .expect(HttpStatus.OK);

            // Simulate FE: apiClient unwraps → body.data
            const feResult = body.data;
            expect(Array.isArray(feResult)).toBe(true);
            expect(feResult).toHaveLength(2);

            // FE hook should NOT access feResult.data (that would be undefined on an array)
            expect((feResult as any).data).toBeUndefined();
        });
    });
});
