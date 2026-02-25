// Mock the entire privy service and auth strategy modules before any imports
// to prevent the jose ESM import chain from executing
jest.mock('../../core/privy/privy.service', () => ({}));
jest.mock('../../common/guards/strategies/privy-auth.strategy', () => ({
    PrivyAuthStrategy: class MockPrivyAuthStrategy {
        async validate() { return { userId: 'mock', walletAddress: '0xMock' }; }
        getName() { return 'privy'; }
    },
}));

import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { OrdersController } from '../../orders/orders.controller';
import { OrdersService } from '../../orders/orders.service';
import { OrderSide, OrderType, OrderStatus } from '../../orders/constants/order.constants';
import { AuthGuard } from '../../common/guards/auth.guard';
import { OrderResponse } from '../../orders/dto/order-response.dto';
import { createMockOrdersService } from '../helpers/mock-services';
import { MOCK_IDS } from '../helpers/mock-factories';

describe('OrdersController', () => {
    let controller: OrdersController;
    let ordersService: jest.Mocked<OrdersService>;

    const mockWalletAddress = MOCK_IDS.walletAddress;
    const mockUser = { userId: 'dev-user-123' };

    const mockOrderResponse: OrderResponse = {
        statusCode: HttpStatus.CREATED,
        data: {
            orderId: MOCK_IDS.orderId,
            walletAddress: mockWalletAddress,
            assetId: MOCK_IDS.assetId,
            markets: [{ marketId: MOCK_IDS.marketId, maturity: 1748736000 }],
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
        },
    };

    beforeEach(async () => {
        const mockService = createMockOrdersService();

        const module: TestingModule = await Test.createTestingModule({
            controllers: [OrdersController],
            providers: [
                { provide: OrdersService, useValue: mockService },
            ],
        })
            .overrideGuard(AuthGuard)
            .useValue({ canActivate: () => true })
            .compile();

        controller = module.get<OrdersController>(OrdersController);
        ordersService = module.get(OrdersService) as jest.Mocked<OrdersService>;
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('POST /orders/lend/market', () => {
        it('should delegate to ordersService.createLendMarketOrder', async () => {
            const dto = { assetId: MOCK_IDS.assetId, amount: '1000', marketIds: [MOCK_IDS.marketId] };
            ordersService.createLendMarketOrder.mockResolvedValue(mockOrderResponse);

            const result = await controller.createLendMarketOrder(dto, mockWalletAddress, mockUser);

            expect(ordersService.createLendMarketOrder).toHaveBeenCalledWith(
                dto,
                mockWalletAddress,
                mockUser.userId,
            );
            expect(result).toEqual(mockOrderResponse);
        });
    });

    describe('POST /orders/lend/limit', () => {
        it('should delegate to ordersService.createLendLimitOrder', async () => {
            const dto = { assetId: MOCK_IDS.assetId, amount: '1000', marketIds: [MOCK_IDS.marketId], rate: 500 };
            ordersService.createLendLimitOrder.mockResolvedValue(mockOrderResponse);

            const result = await controller.createLendLimitOrder(dto, mockWalletAddress, mockUser);

            expect(ordersService.createLendLimitOrder).toHaveBeenCalledWith(
                dto,
                mockWalletAddress,
                mockUser.userId,
            );
            expect(result).toEqual(mockOrderResponse);
        });
    });

    describe('POST /orders/borrow/market', () => {
        it('should delegate to ordersService.createBorrowMarketOrder', async () => {
            const dto = { assetId: MOCK_IDS.assetId, amount: '5000', marketIds: [MOCK_IDS.marketId] };
            const borrowResponse = {
                ...mockOrderResponse,
                data: { ...mockOrderResponse.data, side: OrderSide.Borrow, type: OrderType.Market, rate: 0 },
            };
            ordersService.createBorrowMarketOrder.mockResolvedValue(borrowResponse);

            const result = await controller.createBorrowMarketOrder(dto, mockWalletAddress, mockUser);

            expect(ordersService.createBorrowMarketOrder).toHaveBeenCalledWith(
                dto,
                mockWalletAddress,
                mockUser.userId,
            );
            expect(result).toEqual(borrowResponse);
        });
    });

    describe('POST /orders/borrow/limit', () => {
        it('should delegate to ordersService.createBorrowLimitOrder', async () => {
            const dto = { assetId: MOCK_IDS.assetId, amount: '5000', marketIds: [MOCK_IDS.marketId], rate: 750 };
            const borrowResponse = {
                ...mockOrderResponse,
                data: { ...mockOrderResponse.data, side: OrderSide.Borrow, type: OrderType.Limit, rate: 7.5 },
            };
            ordersService.createBorrowLimitOrder.mockResolvedValue(borrowResponse);

            const result = await controller.createBorrowLimitOrder(dto, mockWalletAddress, mockUser);

            expect(ordersService.createBorrowLimitOrder).toHaveBeenCalledWith(
                dto,
                mockWalletAddress,
                mockUser.userId,
            );
            expect(result).toEqual(borrowResponse);
        });
    });

    describe('PATCH /orders/:id/cancel', () => {
        it('should delegate to ordersService.cancelOrder', async () => {
            const cancelledOrder = {
                id: MOCK_IDS.orderId,
                status: OrderStatus.Cancelled,
            };
            ordersService.cancelOrder.mockResolvedValue(cancelledOrder as any);

            const result = await controller.cancelOrder(MOCK_IDS.orderId, mockWalletAddress);

            expect(ordersService.cancelOrder).toHaveBeenCalledWith(
                MOCK_IDS.orderId,
                mockWalletAddress,
            );
            expect(result).toEqual(cancelledOrder);
        });

        it('should pass wallet address from decorator', async () => {
            const differentWallet = '0xDifferentWallet1234567890abcdef12345678';
            ordersService.cancelOrder.mockResolvedValue({ status: OrderStatus.Cancelled } as any);

            await controller.cancelOrder(MOCK_IDS.orderId, differentWallet);

            expect(ordersService.cancelOrder).toHaveBeenCalledWith(
                MOCK_IDS.orderId,
                differentWallet,
            );
        });
    });

    describe('edge cases', () => {
        it('should return result from service (lend market)', async () => {
            const dto = { assetId: MOCK_IDS.assetId, amount: '500', marketIds: [MOCK_IDS.marketId] };
            const customResponse = { ...mockOrderResponse, data: { ...mockOrderResponse.data, originalAmount: '500' } };
            ordersService.createLendMarketOrder.mockResolvedValue(customResponse);

            const result = await controller.createLendMarketOrder(dto, mockWalletAddress, mockUser);

            expect(result.data.originalAmount).toBe('500');
        });

        it('should propagate service exceptions', async () => {
            const dto = { assetId: MOCK_IDS.assetId, amount: '1000', marketIds: [MOCK_IDS.marketId] };
            ordersService.createLendMarketOrder.mockRejectedValue(new Error('Service error'));

            await expect(
                controller.createLendMarketOrder(dto, mockWalletAddress, mockUser),
            ).rejects.toThrow('Service error');
        });

        it('should propagate cancel exceptions', async () => {
            ordersService.cancelOrder.mockRejectedValue(new Error('Not found'));

            await expect(
                controller.cancelOrder(MOCK_IDS.orderId, mockWalletAddress),
            ).rejects.toThrow('Not found');
        });
    });
});
