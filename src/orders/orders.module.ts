import { Module, forwardRef } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CoreModule } from "../core/core.module";
import { PriceModule } from "../price/price.module";
import { TokensModule } from "../tokens/tokens.module";
import { MarketModule } from "../market/market.module";
import { PortfolioModule } from "../portfolio/portfolio.module";
import { FaucetModule } from "../faucet/faucet.module";
import { Order } from "./entities/order.entity";
import { OrderMarket } from "./entities/order-market.entity";
import { Account } from "./entities/account.entity";
import { Token } from "../tokens/entities/token.entity";
import { Market } from "../market/entities/market.entity";
import { OrdersController } from "./orders.controller";
import { OrdersService } from "./orders.service";
import { OrderRepository } from "./repositories/order.repository";
import { OrdersWorker } from "./orders.worker";

@Module({
    imports: [
        TypeOrmModule.forFeature([Order, OrderMarket, Account, Token, Market]),
        ConfigModule,
        CoreModule,
        PriceModule,
        TokensModule,
        forwardRef(() => MarketModule),
        forwardRef(() => PortfolioModule),
        FaucetModule,
    ],
    controllers: [OrdersController],
    providers: [OrdersService, OrderRepository, OrdersWorker],
    exports: [OrdersService, OrderRepository],
})
export class OrdersModule {}
