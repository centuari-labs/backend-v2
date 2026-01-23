import {
    Body,
    Controller,
    HttpCode,
    HttpStatus,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    UseGuards,
} from "@nestjs/common";
import { Wallet, CurrentUser } from "../common/decorators/wallet.decorator";
import { AuthGuard } from "../common/guards/auth.guard";
import { CreateBorrowLimitOrderDto } from "./dto/create-borrow-limit-order.dto";
import { CreateBorrowMarketOrderDto } from "./dto/create-borrow-market-order.dto";
import { CreateLendLimitOrderDto } from "./dto/create-lend-limit-order.dto";
import { CreateLendMarketOrderDto } from "./dto/create-lend-market-order.dto";
import { OrdersService } from "./orders.service";
import { OrderResponse } from "./dto/order-response.dto";
import { Order } from "./entities/order.entity";

@Controller("orders")
@UseGuards(AuthGuard)
export class OrdersController {
    constructor(private readonly ordersService: OrdersService) {}

    @Post("lend/market")
    @HttpCode(HttpStatus.CREATED)
    async createLendMarketOrder(
        @Body() dto: CreateLendMarketOrderDto,
        @Wallet() walletAddress: string,
        @CurrentUser() user: { userId: string },
    ): Promise<OrderResponse> {
        const order = await this.ordersService.createLendMarketOrder(dto, walletAddress, user.userId);
        return this.mapToResponse(order, dto, walletAddress);
    }

    @Post("lend/limit")
    @HttpCode(HttpStatus.CREATED)
    async createLendLimitOrder(
        @Body() dto: CreateLendLimitOrderDto,
        @Wallet() walletAddress: string,
        @CurrentUser() user: { userId: string },
    ): Promise<OrderResponse> {
        const order = await this.ordersService.createLendLimitOrder(dto, walletAddress, user.userId);
        return this.mapToResponse(order, dto, walletAddress);
    }

    @Post("borrow/market")
    @HttpCode(HttpStatus.CREATED)
    async createBorrowMarketOrder(
        @Body() dto: CreateBorrowMarketOrderDto,
        @Wallet() walletAddress: string,
        @CurrentUser() user: { userId: string },
    ): Promise<OrderResponse> {
        const order = await this.ordersService.createBorrowMarketOrder(dto, walletAddress, user.userId);
        return this.mapToResponse(order, dto, walletAddress);
    }

    @Post("borrow/limit")
    @HttpCode(HttpStatus.CREATED)
    async createBorrowLimitOrder(
        @Body() dto: CreateBorrowLimitOrderDto,
        @Wallet() walletAddress: string,
        @CurrentUser() user: { userId: string },
    ): Promise<OrderResponse> {
        const order = await this.ordersService.createBorrowLimitOrder(dto, walletAddress, user.userId);
        return this.mapToResponse(order, dto, walletAddress);
    }

    @Patch(":id/cancel")
    async cancelOrder(
        @Param("id", ParseUUIDPipe) id: string,
        @Wallet() walletAddress: string,
    ) {
        return this.ordersService.cancelOrder(id, walletAddress);
    }

    private mapToResponse(
        order: Order,
        dto: { loanToken: string; maturities?: number[] },
        walletAddress: string,
    ): OrderResponse {
        return {
            statusCode: HttpStatus.CREATED,
            data: {
                orderId: order.id,
                walletAddress: walletAddress,
                loanToken: dto.loanToken,
                maturities: dto.maturities ?? [],
                timestamp: new Date(order.createdAt).getTime(),
                side: order.side.toLowerCase(),
                type: order.type.toLowerCase(),
                status: order.status.toLowerCase(),
                originalAmount: order.quantity,
                remainingAmount: order.quantity,
                settlementFeeAmount: order.settlementFee,
                rate: Number(order.rate),
                transactionHash: null,
                blockNumber: null,
                createdAt: order.createdAt,
                updatedAt: order.updatedAt,
                filledAt: null,
                cancelledAt: null,
            },
        };
    }
}
