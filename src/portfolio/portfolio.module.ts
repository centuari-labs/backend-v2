import { Module, forwardRef } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { PortfolioController } from "./portfolio.controller";
import { PortfolioService } from "./portfolio.service";
import { Portfolio } from "./entities/portfolio.entity";
import { Token } from "../tokens/entities/token.entity";
import { CoreModule } from "../core/core.module";
import { PortfolioRepository } from "./repositories/portfolio.repository";
import { OrdersModule } from "../orders/orders.module";
import { PriceModule } from "../price/price.module";
import { TokensModule } from "../tokens/tokens.module";

@Module({
    imports: [
        TypeOrmModule.forFeature([Portfolio, Token]),
        CoreModule,
        forwardRef(() => OrdersModule),
        PriceModule,
        TokensModule,
    ],
    controllers: [PortfolioController],
    providers: [
        PortfolioService,
        PortfolioRepository,

    ],
    exports: [PortfolioService],
})
export class PortfolioModule { }
