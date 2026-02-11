import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { PortfolioController } from "./portfolio.controller";
import { PortfolioService } from "./portfolio.service";
import { Portfolio } from "./entities/portfolio.entity";
import { CoreModule } from "../core/core.module";
import { PortfolioRepository } from "./repositories/portfolio.repository";
import { OrdersModule } from "../orders/orders.module";
import { PriceModule } from "../price/price.module";
import { TokensModule } from "../tokens/tokens.module";
import { PortfolioAuthStrategyFactory } from "./auth/auth-strategy.factory";
import { PrivyAuthStrategy } from "./auth/strategies/privy-auth.strategy";
import { DevAuthStrategy } from "./auth/strategies/dev-auth.strategy";

@Module({
    imports: [
        TypeOrmModule.forFeature([Portfolio]),
        CoreModule,
        OrdersModule,
        PriceModule,
        TokensModule,
    ],
    controllers: [PortfolioController],
    providers: [
        PortfolioService,
        PortfolioRepository,
        PrivyAuthStrategy,
        DevAuthStrategy,
        PortfolioAuthStrategyFactory,
    ],
    exports: [PortfolioService],
})
export class PortfolioModule { }
