import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CoreModule } from "../core/core.module";
import { TokensModule } from "../tokens/tokens.module";
import { Order } from "./entities/order.entity";
import { Account } from "./entities/account.entity";
import { Token } from "../tokens/entities/token.entity";
import { OrdersController } from "./orders.controller";
import { OrdersService } from "./orders.service";

@Module({
    imports: [
        TypeOrmModule.forFeature([Order, Account, Token]),
        CoreModule,
        TokensModule,
    ],
    controllers: [OrdersController],
    providers: [OrdersService],
    exports: [OrdersService],
})
export class OrdersModule {}
