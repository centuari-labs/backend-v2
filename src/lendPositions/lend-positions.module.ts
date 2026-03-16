import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CoreModule } from "../core/core.module";
import { OrdersModule } from "../orders/orders.module";
import { LendPositionsController } from "./lend-positions.controller";
import { LendPositionsService } from "./lend-positions.service";
import { LendPositionsRepository } from "./repositories/lend-positions.repository";
import { LendPosition } from "./entities/lend-position.entity";

@Module({
    imports: [
        TypeOrmModule.forFeature([LendPosition]),
        ConfigModule,
        CoreModule,
        OrdersModule,
    ],
    controllers: [LendPositionsController],
    providers: [LendPositionsService, LendPositionsRepository],
    exports: [LendPositionsService],
})
export class LendPositionsModule {}
