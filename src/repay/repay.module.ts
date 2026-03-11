import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { CoreModule } from "../core/core.module";
import { OrdersModule } from "../orders/orders.module";
import { PortfolioModule } from "../portfolio/portfolio.module";
import { TokensModule } from "../tokens/tokens.module";
import { RepayController } from "./repay.controller";
import { RepayService } from "./repay.service";
import { RepayRepository } from "./repositories/repay.repository";

@Module({
    imports: [
        ConfigModule,
        CoreModule,
        TokensModule,
        PortfolioModule,
        OrdersModule,
    ],
    controllers: [RepayController],
    providers: [RepayService, RepayRepository],
    exports: [RepayService, RepayRepository],
})
export class RepayModule { }
