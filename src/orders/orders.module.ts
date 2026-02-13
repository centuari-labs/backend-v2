import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CoreModule } from "../core/core.module";
import { PriceModule } from "../price/price.module";
import { TokensModule } from "../tokens/tokens.module";
import { Order } from "./entities/order.entity";
import { Account } from "./entities/account.entity";
import { Token } from "../tokens/entities/token.entity";
import { OrdersController } from "./orders.controller";
import { OrdersService } from "./orders.service";
import { OrderRepository } from "./repositories/order.repository";

@Module({
    imports: [
        TypeOrmModule.forFeature([Order, Account, Token]),
        CoreModule,
        PriceModule,
        TokensModule,
    ],
    controllers: [OrdersController],
    providers: [OrdersService, OrderRepository],
    exports: [OrdersService, OrderRepository],
})
export class OrdersModule { }
