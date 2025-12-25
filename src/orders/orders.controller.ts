import {
    Controller,
    Post,
    Body,
    Param,
    ParseIntPipe,
    HttpCode,
    HttpStatus,
    Patch,
    UseGuards,
} from "@nestjs/common";
import { OrdersService } from "./orders.service";
import { CreateLendMarketOrderDto } from "./dto/create-lend-market-order.dto";
import { CreateLendLimitOrderDto } from "./dto/create-lend-limit-order.dto";
import { CreateBorrowMarketOrderDto } from "./dto/create-borrow-market-order.dto";
import { CreateBorrowLimitOrderDto } from "./dto/create-borrow-limit-order.dto";
import { AuthGuard } from "../common/guards/auth.guard";
import { Wallet } from "../common/decorators/wallet.decorator";

@Controller("orders")
@UseGuards(AuthGuard)
export class OrdersController {
    constructor(private readonly ordersService: OrdersService) {}

    @Post("lend/market")
    @HttpCode(HttpStatus.CREATED)
    async createLendMarketOrder(
        @Body() dto: CreateLendMarketOrderDto,
        @Wallet() walletAddress: string,
    ) {
        return this.ordersService.createLendMarketOrder(dto, walletAddress);
    }

    @Post("lend/limit")
    @HttpCode(HttpStatus.CREATED)
    async createLendLimitOrder(
        @Body() dto: CreateLendLimitOrderDto,
        @Wallet() walletAddress: string,
    ) {
        return this.ordersService.createLendLimitOrder(dto, walletAddress);
    }

    @Post("borrow/market")
    @HttpCode(HttpStatus.CREATED)
    async createBorrowMarketOrder(
        @Body() dto: CreateBorrowMarketOrderDto,
        @Wallet() walletAddress: string,
    ) {
        return this.ordersService.createBorrowMarketOrder(dto, walletAddress);
    }

    @Post("borrow/limit")
    @HttpCode(HttpStatus.CREATED)
    async createBorrowLimitOrder(
        @Body() dto: CreateBorrowLimitOrderDto,
        @Wallet() walletAddress: string,
    ) {
        return this.ordersService.createBorrowLimitOrder(dto, walletAddress);
    }

    @Patch(":id/cancel")
    async cancelOrder(
        @Param("id", ParseIntPipe) id: number,
        @Wallet() walletAddress: string,
    ) {
        return this.ordersService.cancelOrder(id, walletAddress);
    }
}
