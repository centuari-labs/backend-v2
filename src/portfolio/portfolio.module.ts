import { Module, forwardRef } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ConfigModule } from "@nestjs/config";
import { PortfolioController } from "./portfolio.controller";
import { PortfolioService } from "./portfolio.service";
import { LegacyPortfolio } from "./entities/legacy-portfolio.entity";
import { Token } from "../tokens/entities/token.entity";
import { UserBalance } from "./entities/user-balance.entity";
import { LendPosition } from "./entities/lend-position.entity";
import { BorrowPosition } from "./entities/borrow-position.entity";
import { Market } from "../market/entities/market.entity";
import { CoreModule } from "../core/core.module";
import { PortfolioRepository } from "./repositories/portfolio.repository";
import { RepayService } from "./repay.service";
import { RepayRepository } from "./repositories/repay.repository";
import { OrdersModule } from "../orders/orders.module";
import { PriceModule } from "../price/price.module";
import { TokensModule } from "../tokens/tokens.module";
import { MarketModule } from "../market/market.module";

@Module({
    imports: [
        TypeOrmModule.forFeature([
            LegacyPortfolio,
            Token,
            UserBalance,
            LendPosition,
            BorrowPosition,
            Market,
        ]),
        ConfigModule,
        forwardRef(() => CoreModule),
        forwardRef(() => OrdersModule),
        PriceModule,
        TokensModule,
        MarketModule,
    ],
    controllers: [PortfolioController],
    providers: [PortfolioService, PortfolioRepository, RepayService, RepayRepository],
    exports: [PortfolioService, PortfolioRepository, RepayService, RepayRepository],
})
export class PortfolioModule {}
