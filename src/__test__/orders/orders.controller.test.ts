jest.mock("../../core/privy/privy.service", () => ({}));
jest.mock("jose", () => ({}));
jest.mock("@privy-io/server-auth", () => ({
    PrivyClient: jest.fn(),
}));

import { HttpStatus } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { AuthGuard } from "../../common/guards/auth.guard";
import {
    OrderSide,
    OrderStatus,
    OrderType,
} from "../../orders/constants/order.constants";
import type { Order } from "../../orders/entities/order.entity";
import { OrdersController } from "../../orders/orders.controller";
import { OrdersService } from "../../orders/orders.service";

describe("OrdersController", () => {
    let controller: OrdersController;
    let ordersService: jest.Mocked<OrdersService>;

    const mockWalletAddress = "0xWallet1234567890abcdef1234567890abcdef12";
    const mockUser = { userId: "did:privy:user123" };

    const createMockOrder = (overrides: Partial<Order> = {}): Order => ({
        id: "uuid-order-001",
        accountId: "uuid-account-001",
        assetId: "uuid-asset-001",
        quantity: "1000",
        filledQuantity: "0",
        settlementFee: "0",
        side: OrderSide.Lend,
        type: OrderType.Limit,
        status: OrderStatus.Open,
        rate: 500,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
        ...overrides,
    });

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [OrdersController],
            providers: [
                {
                    provide: OrdersService,
                    useValue: {
                        createLendMarketOrder: jest.fn(),
                        createLendLimitOrder: jest.fn(),
                        createBorrowMarketOrder: jest.fn(),
                        createBorrowLimitOrder: jest.fn(),
                        cancelOrder: jest.fn(),
                    },
                },
            ],
        })
            .overrideGuard(AuthGuard)
            .useValue({ canActivate: () => true })
            .compile();

        controller = module.get<OrdersController>(OrdersController);
        ordersService = module.get(OrdersService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("createLendMarketOrder", () => {
        it("should delegate to service and return mapped response", async () => {
            const dto = {
                loanToken: "0xToken123",
                amount: "1000",
                maturities: [1704067200],
            };
            const order = createMockOrder({
                side: OrderSide.Lend,
                type: OrderType.Market,
                rate: 0,
            });
            ordersService.createLendMarketOrder.mockResolvedValue(order);

            const result = await controller.createLendMarketOrder(
                dto,
                mockWalletAddress,
                mockUser,
            );

            expect(ordersService.createLendMarketOrder).toHaveBeenCalledWith(
                dto,
                mockWalletAddress,
                mockUser.userId,
            );
            expect(result.statusCode).toBe(HttpStatus.CREATED);
            expect(result.data.orderId).toBe(order.id);
            expect(result.data.walletAddress).toBe(mockWalletAddress);
            expect(result.data.loanToken).toBe(dto.loanToken);
            expect(result.data.side).toBe("lend");
            expect(result.data.type).toBe("market");
            expect(result.data.status).toBe("open");
        });
    });

    describe("createLendLimitOrder", () => {
        it("should delegate to service and return mapped response", async () => {
            const dto = {
                loanToken: "0xToken123",
                amount: "500",
                maturities: [1704067200],
                rate: 250,
            };
            const order = createMockOrder({
                side: OrderSide.Lend,
                type: OrderType.Limit,
                rate: 250,
            });
            ordersService.createLendLimitOrder.mockResolvedValue(order);

            const result = await controller.createLendLimitOrder(
                dto,
                mockWalletAddress,
                mockUser,
            );

            expect(ordersService.createLendLimitOrder).toHaveBeenCalledWith(
                dto,
                mockWalletAddress,
                mockUser.userId,
            );
            expect(result.statusCode).toBe(HttpStatus.CREATED);
            expect(result.data.rate).toBe(250);
        });
    });

    describe("createBorrowMarketOrder", () => {
        it("should delegate to service and return mapped response", async () => {
            const dto = {
                loanToken: "0xToken123",
                amount: "2000",
                maturities: [1704067200],
            };
            const order = createMockOrder({
                side: OrderSide.Borrow,
                type: OrderType.Market,
                rate: 0,
            });
            ordersService.createBorrowMarketOrder.mockResolvedValue(order);

            const result = await controller.createBorrowMarketOrder(
                dto,
                mockWalletAddress,
                mockUser,
            );

            expect(ordersService.createBorrowMarketOrder).toHaveBeenCalledWith(
                dto,
                mockWalletAddress,
                mockUser.userId,
            );
            expect(result.data.side).toBe("borrow");
            expect(result.data.type).toBe("market");
        });
    });

    describe("createBorrowLimitOrder", () => {
        it("should delegate to service and return mapped response", async () => {
            const dto = {
                loanToken: "0xToken123",
                amount: "3000",
                maturities: [1704067200],
                rate: 750,
            };
            const order = createMockOrder({
                side: OrderSide.Borrow,
                type: OrderType.Limit,
                rate: 750,
            });
            ordersService.createBorrowLimitOrder.mockResolvedValue(order);

            const result = await controller.createBorrowLimitOrder(
                dto,
                mockWalletAddress,
                mockUser,
            );

            expect(result.data.side).toBe("borrow");
            expect(result.data.type).toBe("limit");
            expect(result.data.rate).toBe(750);
        });
    });

    describe("cancelOrder", () => {
        it("should delegate to service with orderId and walletAddress", async () => {
            const cancelledOrder = createMockOrder({
                status: OrderStatus.Cancelled,
            });
            ordersService.cancelOrder.mockResolvedValue(cancelledOrder);

            const result = await controller.cancelOrder(
                "uuid-order-001",
                mockWalletAddress,
            );

            expect(ordersService.cancelOrder).toHaveBeenCalledWith(
                "uuid-order-001",
                mockWalletAddress,
            );
            expect(result.status).toBe(OrderStatus.Cancelled);
        });
    });

    describe("mapToResponse", () => {
        it("should map maturities to empty array when not provided", async () => {
            const dto = {
                loanToken: "0xToken123",
                amount: "1000",
                maturities: [1704067200],
            };
            const order = createMockOrder({
                side: OrderSide.Lend,
                type: OrderType.Market,
            });
            ordersService.createLendMarketOrder.mockResolvedValue(order);

            const result = await controller.createLendMarketOrder(
                dto,
                mockWalletAddress,
                mockUser,
            );

            expect(result.data.maturities).toEqual([1704067200]);
            expect(result.data.transactionHash).toBeNull();
            expect(result.data.blockNumber).toBeNull();
            expect(result.data.filledAt).toBeNull();
            expect(result.data.cancelledAt).toBeNull();
        });

        it("should include originalAmount and remainingAmount from order quantity", async () => {
            const dto = {
                loanToken: "0xToken123",
                amount: "5000",
                maturities: [1704067200],
                rate: 100,
            };
            const order = createMockOrder({ quantity: "5000" });
            ordersService.createLendLimitOrder.mockResolvedValue(order);

            const result = await controller.createLendLimitOrder(
                dto,
                mockWalletAddress,
                mockUser,
            );

            expect(result.data.originalAmount).toBe("5000");
            expect(result.data.remainingAmount).toBe("5000");
            expect(result.data.settlementFeeAmount).toBe("0");
        });
    });
});
