import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Order } from "../orders/entities/order.entity";
import { OrderMarket } from "../orders/entities/order-market.entity";
import { RateController } from "./rate-history.controller";
import { RateService } from "./rate-history.service";
import { RateRepository } from "./repositories/rate-history.respository";

@Module({
    imports: [TypeOrmModule.forFeature([Order, OrderMarket])],
    controllers: [RateController],
    providers: [RateService, RateRepository],
})
export class RateModule { }
