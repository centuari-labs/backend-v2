import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { CoreModule } from "../core/core.module";
import { TokensModule } from "../tokens/tokens.module";
import { PortfolioModule } from "../portfolio/portfolio.module";
import { OrdersModule } from "../orders/orders.module";
import { WithdrawController } from "./withdraw.controller";
import { WithdrawService } from "./withdraw.service";

@Module({
    imports: [CoreModule, ConfigModule, TokensModule, PortfolioModule, OrdersModule],
    controllers: [WithdrawController],
    providers: [WithdrawService],
})
export class WithdrawModule {}
