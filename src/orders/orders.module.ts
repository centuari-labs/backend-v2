import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { OrdersController } from "./orders.controller";
import { OrdersService } from "./orders.service";
import { Order } from "./entities/order.entity";
import { OrderHistory } from "./entities/order-history.entity";
import { CoreModule } from "../core/core.module";
import { TokensModule } from "../tokens/tokens.module";

@Module({
    imports: [
        TypeOrmModule.forFeature([Order, OrderHistory]),
        CoreModule,
        TokensModule,
    ],
    controllers: [OrdersController],
    providers: [OrdersService],
    exports: [OrdersService],
})
export class OrdersModule {}
