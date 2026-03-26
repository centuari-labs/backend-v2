jest.mock("../../core/privy/privy.service", () => ({
    PrivyService: jest.fn().mockImplementation(() => ({
        verify: jest.fn(),
        getUser: jest.fn(),
    })),
}));

import { HttpStatus } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { PrivyService } from "../../core/privy/privy.service";
import {
    OrderSide,
    OrderStatus,
    OrderType,
} from "../../orders/constants/order.constants";
import { OrdersController } from "../../orders/orders.controller";
import { OrdersService } from "../../orders/orders.service";
import { createMockOrder } from "../helpers/mock-factories";

describe("OrdersController", () => {
    let controller: OrdersController;
    let ordersService: {
        createLendMarketOrder: jest.Mock;
        createLendLimitOrder: jest.Mock;
        createBorrowMarketOrder: jest.Mock;
        createBorrowLimitOrder: jest.Mock;
        cancelOrder: jest.Mock;
    };

    beforeEach(async () => {
        ordersService = {
            createLendMarketOrder: jest.fn(),
            createLendLimitOrder: jest.fn(),
            createBorrowMarketOrder: jest.fn(),
            createBorrowLimitOrder: jest.fn(),
            cancelOrder: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            controllers: [OrdersController],
            providers: [
                { provide: OrdersService, useValue: ordersService },
                {
                    provide: PrivyService,
                    useValue: { verify: jest.fn(), getUser: jest.fn() },
                },
            ],
        }).compile();

        controller = module.get<OrdersController>(OrdersController);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    const wallet = "0xWallet123";
    const user = { userId: "user-1" };

    describe("createLendMarketOrder", () => {
        const dto = {
            loanToken: "0xToken",
            amount: "1000",
            maturities: [1700000000],
        };

        it("should delegate to service and map response", async () => {
            const order = createMockOrder({
                side: OrderSide.Lend,
                type: OrderType.Market,
                rate: 0,
            });
            ordersService.createLendMarketOrder.mockResolvedValue(order);

            const result = await controller.createLendMarketOrder(
                dto,
                wallet,
                user,
            );

            expect(ordersService.createLendMarketOrder).toHaveBeenCalledWith(
                dto,
                wallet,
                "user-1",
            );
            expect(result.statusCode).toBe(HttpStatus.CREATED);
            expect(result.data.side).toBe("lend");
            expect(result.data.type).toBe("market");
            expect(result.data.walletAddress).toBe(wallet);
            expect(result.data.loanToken).toBe("0xToken");
        });

        it("should map maturities from dto", async () => {
            const order = createMockOrder({ rate: 0 });
            ordersService.createLendMarketOrder.mockResolvedValue(order);

            const result = await controller.createLendMarketOrder(
                dto,
                wallet,
                user,
            );

            expect(result.data.maturities).toEqual([1700000000]);
        });
    });

    describe("createLendLimitOrder", () => {
        const dto = {
            loanToken: "0xToken",
            amount: "500",
            maturities: [1700000000],
            rate: 250,
        };

        it("should delegate to service and return mapped response", async () => {
            const order = createMockOrder({
                side: OrderSide.Lend,
                type: OrderType.Limit,
                rate: 250,
                quantity: "500",
            });
            ordersService.createLendLimitOrder.mockResolvedValue(order);

            const result = await controller.createLendLimitOrder(
                dto,
                wallet,
                user,
            );

            expect(ordersService.createLendLimitOrder).toHaveBeenCalledWith(
                dto,
                wallet,
                "user-1",
            );
            expect(result.statusCode).toBe(HttpStatus.CREATED);
            expect(result.data.rate).toBe(250);
        });
    });

    describe("createBorrowMarketOrder", () => {
        const dto = {
            loanToken: "0xToken",
            amount: "2000",
            maturities: [1700000000],
        };

        it("should delegate to service and return mapped response", async () => {
            const order = createMockOrder({
                side: OrderSide.Borrow,
                type: OrderType.Market,
                rate: 0,
                quantity: "2000",
            });
            ordersService.createBorrowMarketOrder.mockResolvedValue(order);

            const result = await controller.createBorrowMarketOrder(
                dto,
                wallet,
                user,
            );

            expect(ordersService.createBorrowMarketOrder).toHaveBeenCalledWith(
                dto,
                wallet,
                "user-1",
            );
            expect(result.data.side).toBe("borrow");
            expect(result.data.type).toBe("market");
        });
    });

    describe("createBorrowLimitOrder", () => {
        const dto = {
            loanToken: "0xToken",
            amount: "3000",
            maturities: [1700000000],
            rate: 750,
        };

        it("should delegate to service and return mapped response", async () => {
            const order = createMockOrder({
                side: OrderSide.Borrow,
                type: OrderType.Limit,
                rate: 750,
                quantity: "3000",
            });
            ordersService.createBorrowLimitOrder.mockResolvedValue(order);

            const result = await controller.createBorrowLimitOrder(
                dto,
                wallet,
                user,
            );

            expect(ordersService.createBorrowLimitOrder).toHaveBeenCalledWith(
                dto,
                wallet,
                "user-1",
            );
            expect(result.data.side).toBe("borrow");
            expect(result.data.type).toBe("limit");
            expect(result.data.rate).toBe(750);
        });
    });

    describe("cancelOrder", () => {
        it("should delegate to service with id and wallet", async () => {
            const cancelledOrder = createMockOrder({
                status: OrderStatus.Cancelled,
            });
            ordersService.cancelOrder.mockResolvedValue(cancelledOrder);

            const result = await controller.cancelOrder("order-uuid-1", wallet);

            expect(ordersService.cancelOrder).toHaveBeenCalledWith(
                "order-uuid-1",
                wallet,
            );
            expect(result.status).toBe(OrderStatus.Cancelled);
        });

        it("should propagate service errors", async () => {
            ordersService.cancelOrder.mockRejectedValue(new Error("Not found"));

            await expect(
                controller.cancelOrder("bad-id", wallet),
            ).rejects.toThrow("Not found");
        });
    });

    describe("mapToResponse", () => {
        it("should set transactionHash and blockNumber to null", async () => {
            const order = createMockOrder();
            ordersService.createLendLimitOrder.mockResolvedValue(order);

            const dto = {
                loanToken: "0xT",
                amount: "100",
                maturities: [1],
                rate: 100,
            };
            const result = await controller.createLendLimitOrder(
                dto,
                wallet,
                user,
            );

            expect(result.data.transactionHash).toBeNull();
            expect(result.data.blockNumber).toBeNull();
            expect(result.data.filledAt).toBeNull();
            expect(result.data.cancelledAt).toBeNull();
        });

        it("should set remainingAmount equal to originalAmount", async () => {
            const order = createMockOrder({ quantity: "5000" });
            ordersService.createLendLimitOrder.mockResolvedValue(order);

            const dto = {
                loanToken: "0xT",
                amount: "5000",
                maturities: [1],
                rate: 100,
            };
            const result = await controller.createLendLimitOrder(
                dto,
                wallet,
                user,
            );

            expect(result.data.originalAmount).toBe("5000");
            expect(result.data.remainingAmount).toBe("5000");
        });

        it("should lowercase side, type, and status in response", async () => {
            const order = createMockOrder({
                side: OrderSide.Borrow,
                type: OrderType.Limit,
                status: OrderStatus.Open,
            });
            ordersService.createBorrowLimitOrder.mockResolvedValue(order);

            const dto = {
                loanToken: "0xT",
                amount: "100",
                maturities: [],
                rate: 100,
            };
            const result = await controller.createBorrowLimitOrder(
                dto,
                wallet,
                user,
            );

            expect(result.data.side).toBe("borrow");
            expect(result.data.type).toBe("limit");
            expect(result.data.status).toBe("open");
        });

        it("should use empty array when maturities is undefined", async () => {
            const order = createMockOrder();
            ordersService.createLendLimitOrder.mockResolvedValue(order);

            const dto = { loanToken: "0xT", amount: "100", rate: 100 } as any;
            const result = await controller.createLendLimitOrder(
                dto,
                wallet,
                user,
            );

            expect(result.data.maturities).toEqual([]);
        });
    });
});
