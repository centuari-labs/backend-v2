import {
    Body,
    Controller,
    Get,
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

@Controller("orders")
@UseGuards(AuthGuard)
export class OrdersController {
    constructor(private readonly ordersService: OrdersService) {}

    @Get("open-amounts")
    async getOpenLendAmounts(
        @Wallet() walletAddress: string,
    ): Promise<{ assetId: string; lockedAmount: string }[]> {
        return this.ordersService.getOpenLendAmounts(walletAddress);
    }

    @Post("lend/market")
    @HttpCode(HttpStatus.CREATED)
    async createLendMarketOrder(
        @Body() dto: CreateLendMarketOrderDto,
        @Wallet() walletAddress: string,
        @CurrentUser() user: { userId: string },
    ): Promise<OrderResponse> {
        return this.ordersService.createLendMarketOrder(
            dto,
            walletAddress,
            user.userId,
        );
    }

    @Post("lend/limit")
    @HttpCode(HttpStatus.CREATED)
    async createLendLimitOrder(
        @Body() dto: CreateLendLimitOrderDto,
        @Wallet() walletAddress: string,
        @CurrentUser() user: { userId: string },
    ): Promise<OrderResponse> {
        return this.ordersService.createLendLimitOrder(
            dto,
            walletAddress,
            user.userId,
        );
    }

    @Post("borrow/market")
    @HttpCode(HttpStatus.CREATED)
    async createBorrowMarketOrder(
        @Body() dto: CreateBorrowMarketOrderDto,
        @Wallet() walletAddress: string,
        @CurrentUser() user: { userId: string },
    ): Promise<OrderResponse> {
        return this.ordersService.createBorrowMarketOrder(
            dto,
            walletAddress,
            user.userId,
        );
    }

    @Post("borrow/limit")
    @HttpCode(HttpStatus.CREATED)
    async createBorrowLimitOrder(
        @Body() dto: CreateBorrowLimitOrderDto,
        @Wallet() walletAddress: string,
        @CurrentUser() user: { userId: string },
    ): Promise<OrderResponse> {
        return this.ordersService.createBorrowLimitOrder(
            dto,
            walletAddress,
            user.userId,
        );
    }

    @Patch(":id/cancel")
    async cancelOrder(
        @Param("id", ParseUUIDPipe) id: string,
        @Wallet() walletAddress: string,
    ) {
        return this.ordersService.cancelOrder(id, walletAddress);
    }
}
