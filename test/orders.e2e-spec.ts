// Mock privy modules to prevent jose ESM import chain
jest.mock('../src/core/privy/privy.service', () => ({}));
jest.mock('../src/common/guards/strategies/privy-auth.strategy', () => ({
    PrivyAuthStrategy: class MockPrivyAuthStrategy {
        async validate() { return { userId: 'mock', walletAddress: '0xMock' }; }
        getName() { return 'privy'; }
    },
}));

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { OrdersController } from '../src/orders/orders.controller';
import { OrdersService } from '../src/orders/orders.service';
import { AuthGuard } from '../src/common/guards/auth.guard';
import { AuthStrategyFactory } from '../src/common/guards/strategies/auth-strategy.factory';
import { DevAuthStrategy } from '../src/common/guards/strategies/dev-auth.strategy';
import { PrivyAuthStrategy } from '../src/common/guards/strategies/privy-auth.strategy';
import { OrderSide, OrderType, OrderStatus } from '../src/orders/constants/order.constants';
import { OrderResponse } from '../src/orders/dto/order-response.dto';

describe('Orders E2E', () => {
    let app: INestApplication<App>;
    let ordersService: jest.Mocked<OrdersService>;

    const mockAssetId = 'b0000000-0000-0000-0000-000000000001';
    const mockMarketId = 'c0000000-0000-0000-0000-000000000001';
    const mockOrderId = 'd0000000-0000-0000-0000-000000000001';
    const devWallet = '0xTestWallet123';
    const devToken = `DEV_TOKEN_${devWallet}`;

    const createOrderResponse = (overrides: Partial<OrderResponse['data']> = {}): OrderResponse => ({
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
            originalAmount: '1000',
            settlementFeeAmount: '50000',
            autoRollover: false,
            rate: 5,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...overrides,
        },
    });

    beforeAll(async () => {
        const originalEnv = process.env.AUTH_MODE;
        process.env.AUTH_MODE = 'development';

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
                    useValue: { validate: jest.fn(), getName: () => 'privy' },
                },
            ],
        }).compile();

        app = moduleFixture.createNestApplication();
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

    describe('POST /orders/lend/market', () => {
        it('should create a lend market order', async () => {
            const resp = createOrderResponse({ side: OrderSide.Lend, type: OrderType.Market, rate: 0 });
            ordersService.createLendMarketOrder.mockResolvedValue(resp);

            const { body } = await request(app.getHttpServer())
                .post('/orders/lend/market')
                .set('Authorization', `Bearer ${devToken}`)
                .send({
                    assetId: mockAssetId,
                    amount: '1000',
                    marketIds: [mockMarketId],
                })
                .expect(HttpStatus.CREATED);

            expect(body.statusCode).toBe(HttpStatus.CREATED);
            expect(ordersService.createLendMarketOrder).toHaveBeenCalledWith(
                expect.objectContaining({ assetId: mockAssetId }),
                devWallet,
                `dev-user-${devWallet}`,
            );
        });
    });

    describe('POST /orders/lend/limit', () => {
        it('should create a lend limit order', async () => {
            const resp = createOrderResponse({ side: OrderSide.Lend, type: OrderType.Limit, rate: 5 });
            ordersService.createLendLimitOrder.mockResolvedValue(resp);

            const { body } = await request(app.getHttpServer())
                .post('/orders/lend/limit')
                .set('Authorization', `Bearer ${devToken}`)
                .send({
                    assetId: mockAssetId,
                    amount: '1000',
                    marketIds: [mockMarketId],
                    rate: 500,
                })
                .expect(HttpStatus.CREATED);

            expect(body.statusCode).toBe(HttpStatus.CREATED);
            expect(body.data.rate).toBe(5);
        });
    });

    describe('POST /orders/borrow/market', () => {
        it('should create a borrow market order', async () => {
            const resp = createOrderResponse({ side: OrderSide.Borrow, type: OrderType.Market, rate: 0 });
            ordersService.createBorrowMarketOrder.mockResolvedValue(resp);

            const { body } = await request(app.getHttpServer())
                .post('/orders/borrow/market')
                .set('Authorization', `Bearer ${devToken}`)
                .send({
                    assetId: mockAssetId,
                    amount: '5000',
                    marketIds: [mockMarketId],
                })
                .expect(HttpStatus.CREATED);

            expect(body.statusCode).toBe(HttpStatus.CREATED);
            expect(body.data.side).toBe(OrderSide.Borrow);
        });
    });

    describe('POST /orders/borrow/limit', () => {
        it('should create a borrow limit order', async () => {
            const resp = createOrderResponse({ side: OrderSide.Borrow, type: OrderType.Limit, rate: 7.5 });
            ordersService.createBorrowLimitOrder.mockResolvedValue(resp);

            const { body } = await request(app.getHttpServer())
                .post('/orders/borrow/limit')
                .set('Authorization', `Bearer ${devToken}`)
                .send({
                    assetId: mockAssetId,
                    amount: '5000',
                    marketIds: [mockMarketId],
                    rate: 750,
                })
                .expect(HttpStatus.CREATED);

            expect(body.statusCode).toBe(HttpStatus.CREATED);
            expect(body.data.rate).toBe(7.5);
        });
    });

    describe('PATCH /orders/:id/cancel', () => {
        it('should cancel an order', async () => {
            ordersService.cancelOrder.mockResolvedValue({
                id: mockOrderId,
                status: OrderStatus.Cancelled,
            } as any);

            const { body } = await request(app.getHttpServer())
                .patch(`/orders/${mockOrderId}/cancel`)
                .set('Authorization', `Bearer ${devToken}`)
                .expect(HttpStatus.OK);

            expect(body.status).toBe(OrderStatus.Cancelled);
            expect(ordersService.cancelOrder).toHaveBeenCalledWith(mockOrderId, devWallet);
        });
    });

    describe('Authentication', () => {
        it('should reject requests without authorization header', async () => {
            await request(app.getHttpServer())
                .post('/orders/lend/market')
                .send({
                    assetId: mockAssetId,
                    amount: '1000',
                    marketIds: [mockMarketId],
                })
                .expect(HttpStatus.UNAUTHORIZED);
        });

        it('should reject requests with invalid token', async () => {
            await request(app.getHttpServer())
                .post('/orders/lend/market')
                .set('Authorization', 'Bearer INVALID_TOKEN')
                .send({
                    assetId: mockAssetId,
                    amount: '1000',
                    marketIds: [mockMarketId],
                })
                .expect(HttpStatus.UNAUTHORIZED);
        });

        it('should reject requests with non-Bearer auth', async () => {
            await request(app.getHttpServer())
                .post('/orders/lend/market')
                .set('Authorization', 'Basic some-token')
                .send({
                    assetId: mockAssetId,
                    amount: '1000',
                    marketIds: [mockMarketId],
                })
                .expect(HttpStatus.UNAUTHORIZED);
        });
    });

    describe('Response shape', () => {
        it('should return proper OrderResponse structure', async () => {
            const resp = createOrderResponse();
            ordersService.createLendLimitOrder.mockResolvedValue(resp);

            const { body } = await request(app.getHttpServer())
                .post('/orders/lend/limit')
                .set('Authorization', `Bearer ${devToken}`)
                .send({
                    assetId: mockAssetId,
                    amount: '1000',
                    marketIds: [mockMarketId],
                    rate: 500,
                })
                .expect(HttpStatus.CREATED);

            expect(body).toHaveProperty('statusCode');
            expect(body).toHaveProperty('data');
            expect(body.data).toHaveProperty('orderId');
            expect(body.data).toHaveProperty('walletAddress');
            expect(body.data).toHaveProperty('assetId');
            expect(body.data).toHaveProperty('markets');
            expect(body.data).toHaveProperty('side');
            expect(body.data).toHaveProperty('type');
            expect(body.data).toHaveProperty('status');
            expect(body.data).toHaveProperty('originalAmount');
            expect(body.data).toHaveProperty('rate');
        });

        it('should pass wallet from dev token to service', async () => {
            const customWallet = '0xMySpecificWallet';
            const token = `DEV_TOKEN_${customWallet}`;
            const resp = createOrderResponse({ walletAddress: customWallet });
            ordersService.createLendMarketOrder.mockResolvedValue(resp);

            await request(app.getHttpServer())
                .post('/orders/lend/market')
                .set('Authorization', `Bearer ${token}`)
                .send({
                    assetId: mockAssetId,
                    amount: '1000',
                    marketIds: [mockMarketId],
                })
                .expect(HttpStatus.CREATED);

            expect(ordersService.createLendMarketOrder).toHaveBeenCalledWith(
                expect.anything(),
                customWallet,
                `dev-user-${customWallet}`,
            );
        });
    });

    describe('Error handling', () => {
        it('should return 500 when service throws', async () => {
            ordersService.createLendMarketOrder.mockRejectedValue(new Error('Internal error'));

            await request(app.getHttpServer())
                .post('/orders/lend/market')
                .set('Authorization', `Bearer ${devToken}`)
                .send({
                    assetId: mockAssetId,
                    amount: '1000',
                    marketIds: [mockMarketId],
                })
                .expect(HttpStatus.INTERNAL_SERVER_ERROR);
        });

        it('should reject cancel with invalid UUID', async () => {
            await request(app.getHttpServer())
                .patch('/orders/not-a-uuid/cancel')
                .set('Authorization', `Bearer ${devToken}`)
                .expect(HttpStatus.BAD_REQUEST);
        });
    });
});
