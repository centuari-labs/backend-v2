import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AnalyticsController } from "./analytics.controller";
import { AnalyticsService } from "./analytics.service";
import { Portfolio } from "./entities/portfolio.entity";
import { LendPosition } from "./entities/lend-position.entity";
import { BorrowPosition } from "./entities/borrow-position.entity";
import { CoreModule } from "../core/core.module";

@Module({
    imports: [
        TypeOrmModule.forFeature([Portfolio, LendPosition, BorrowPosition]),
        CoreModule,
    ],
    controllers: [AnalyticsController],
    providers: [AnalyticsService],
    exports: [AnalyticsService],
})
export class AnalyticsModule { }
