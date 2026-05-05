import {
    Body,
    Controller,
    HttpCode,
    HttpStatus,
    Param,
    ParseUUIDPipe,
    Post,
    Put,
    UseGuards,
} from "@nestjs/common";
import { Wallet, CurrentUser } from "../common/decorators/wallet.decorator";
import { AuthGuard } from "../common/guards/auth.guard";
import { WalletThrottlerGuard } from "../common/guards/wallet-throttler.guard";
import {
    CreateLimitOrderDto,
    CreateMarketOrderDto,
} from "./dto/create-order.dto";
import { OrdersService } from "./orders.service";
import { OrderResponse } from "./dto/order-response.dto";
import { UpdateOrderDto } from "./dto/update-order.dto";

@Controller("orders")
@UseGuards(AuthGuard, WalletThrottlerGuard)
export class OrdersController {
    constructor(private readonly ordersService: OrdersService) {}

    @Post("lend/market")
    @HttpCode(HttpStatus.CREATED)
    async createLendMarketOrder(
        @Body() dto: CreateMarketOrderDto,
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
        @Body() dto: CreateLimitOrderDto,
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
        @Body() dto: CreateMarketOrderDto,
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
        @Body() dto: CreateLimitOrderDto,
        @Wallet() walletAddress: string,
        @CurrentUser() user: { userId: string },
    ): Promise<OrderResponse> {
        return this.ordersService.createBorrowLimitOrder(
            dto,
            walletAddress,
            user.userId,
        );
    }

    @Post(":id/cancel")
    async cancelOrder(
        @Param("id", ParseUUIDPipe) id: string,
        @Wallet() walletAddress: string,
    ) {
        return this.ordersService.cancelOrder(id, walletAddress);
    }

    @Put(":id/update")
    async updateOrder(
        @Param("id", ParseUUIDPipe) id: string,
        @Wallet() walletAddress: string,
        @Body() dto: UpdateOrderDto,
    ) {
        return this.ordersService.updateOrder(id, walletAddress, dto);
    }
}
