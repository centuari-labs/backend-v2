import { Module, forwardRef } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CoreModule } from "../core/core.module";
import { PriceModule } from "../price/price.module";
import { TokensModule } from "../tokens/tokens.module";
import { MarketModule } from "../market/market.module";
import { PortfolioModule } from "../portfolio/portfolio.module";
import { Order } from "./entities/order.entity";
import { OrderMarket } from "./entities/order-market.entity";
import { Account } from "./entities/account.entity";
import { Token } from "../tokens/entities/token.entity";
import { OrdersController } from "./orders.controller";
import { OrdersService } from "./orders.service";
import { OrderRepository } from "./repositories/order.repository";

@Module({
    imports: [
        TypeOrmModule.forFeature([Order, OrderMarket, Account, Token]),
        CoreModule,
        PriceModule,
        TokensModule,
        forwardRef(() => MarketModule),
        forwardRef(() => PortfolioModule),
    ],
    controllers: [OrdersController],
    providers: [OrdersService, OrderRepository],
    exports: [OrdersService, OrderRepository],
})
export class OrdersModule { }
