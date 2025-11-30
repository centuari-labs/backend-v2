import {
    Controller,
    Get,
    Post,
    Body,
    Param,
    Query,
    ParseIntPipe,
    HttpCode,
    HttpStatus,
    Patch,
} from "@nestjs/common";
import { OrdersService } from "./orders.service";
import { CreateOrderGroupDto } from "./dto/create-order-group.dto";
import { CreateLendMarketOrderDto } from "./dto/create-lend-market-order.dto";
import { CreateLendLimitOrderDto } from "./dto/create-lend-limit-order.dto";
import { CreateBorrowMarketOrderDto } from "./dto/create-borrow-market-order.dto";
import { CreateBorrowLimitOrderDto } from "./dto/create-borrow-limit-order.dto";

@Controller("orders")
export class OrdersController {
    constructor(private readonly ordersService: OrdersService) {}

    // order goup
    @Post("groups")
    @HttpCode(HttpStatus.CREATED)
    async createOrderGroup(@Body() dto: CreateOrderGroupDto) {
        return this.ordersService.createOrderGroup(dto);
    }

    @Get("groups/:id")
    async getOrderGroup(@Param("id", ParseIntPipe) id: number) {
        return this.ordersService.getOrderGroup(id);
    }

    @Get("groups")
    async getOrderGroupsByWallet(@Query("wallet_address") walletAddress: string) {
        return this.ordersService.getOrderGroupsByWallet(walletAddress);
    }

    @Patch("groups/:id/status")
    async updateOrderGroupStatus(
        @Param("id", ParseIntPipe) id: number,
        @Body("status") status: "active" | "cancelled" | "completed",
    ) {
        return this.ordersService.updateOrderGroupStatus(id, status);
    }

    @Get("groups/:id/orders")
    async getOrdersByGroup(@Param("id", ParseIntPipe) id: number) {
        return this.ordersService.getOrdersByGroup(id);
    }

    // lend market order
    @Post("lend/market")
    @HttpCode(HttpStatus.CREATED)
    async createLendMarketOrder(@Body() dto: CreateLendMarketOrderDto) {
        return this.ordersService.createLendMarketOrder(dto);
    }

    // lend limir order
    @Post("lend/limit")
    @HttpCode(HttpStatus.CREATED)
    async createLendLimitOrder(@Body() dto: CreateLendLimitOrderDto) {
        return this.ordersService.createLendLimitOrder(dto);
    }

    // borrow market order
    @Post("borrow/market")
    @HttpCode(HttpStatus.CREATED)
    async createBorrowMarketOrder(@Body() dto: CreateBorrowMarketOrderDto) {
        return this.ordersService.createBorrowMarketOrder(dto);
    }

    // borrow limir oreder
    @Post("borrow/limit")
    @HttpCode(HttpStatus.CREATED)
    async createBorrowLimitOrder(@Body() dto: CreateBorrowLimitOrderDto) {
        return this.ordersService.createBorrowLimitOrder(dto);
    }

    @Get(":id")
    async getOrder(@Param("id", ParseIntPipe) id: number) {
        return this.ordersService.getOrder(id);
    }

    @Get()
    async getOrders(
        @Query("wallet_address") walletAddress?: string,
        @Query("order_type") orderType?: "lend_market" | "lend_limit" | "borrow_market" | "borrow_limit",
        @Query("status") status?: "pending" | "partial" | "filled" | "cancelled",
    ) {
        if (walletAddress) {
            return this.ordersService.getOrdersByWallet(walletAddress);
        }

        if (orderType) {
            return this.ordersService.getOrdersByType(orderType);
        }

        if (status) {
            return this.ordersService.getOrdersByStatus(status);
        }

        return [];
    }

    // order management
    @Patch(":id/cancel")
    async cancelOrder(@Param("id", ParseIntPipe) id: number) {
        return this.ordersService.cancelOrder(id);
    }

    @Patch(":id/status")
    async updateOrderStatus(
        @Param("id", ParseIntPipe) id: number,
        @Body() body: {
            status: "pending" | "partial" | "filled" | "cancelled";
            filled_amount?: string;
            transaction_hash?: string;
            block_number?: number;
        },
    ) {
        return this.ordersService.updateOrderStatus(
            id,
            body.status,
            body.filled_amount,
            body.transaction_hash,
            body.block_number,
        );
    }
}
