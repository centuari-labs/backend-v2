import { Module, forwardRef } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { MarketController } from "./market.controller";
import { MarketService } from "./market.service";
import { Market } from "./entities/market.entity";
import { TokensModule } from "../tokens/tokens.module";
import { CoreModule } from "../core/core.module";
import { Token } from "../tokens/entities/token.entity";
import { PriceModule } from "../price/price.module";
import { OrdersModule } from "../orders/orders.module";
import { MarketRepositories } from "./repository/market.repository";
import { RateRepository } from "./repository/rate-history.repository";
import { MarketWorker } from "./market.worker";

@Module({
    imports: [
        TypeOrmModule.forFeature([Market, Token]),
        TokensModule,
        CoreModule,
        PriceModule,
        forwardRef(() => OrdersModule),
    ],
    controllers: [MarketController],
    providers: [
        MarketService,
        MarketRepositories,
        RateRepository,
        MarketWorker,
    ],
    exports: [MarketService, MarketRepositories],
})
export class MarketModule {}
