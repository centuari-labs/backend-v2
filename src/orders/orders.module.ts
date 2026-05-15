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
import { Match } from "./entities/match.entity";
import { Token } from "../tokens/entities/token.entity";
import { WalletThrottlerGuard } from "../common/guards/wallet-throttler.guard";
import { OrdersController } from "./orders.controller";
import { OrdersService } from "./orders.service";
import { OrderRepository } from "./repositories/order.repository";
import { MatchRepository } from "./repositories/match.repository";
import { OrdersWorker } from "./orders.worker";

@Module({
    imports: [
        TypeOrmModule.forFeature([Order, OrderMarket, Account, Match, Token]),
        ConfigModule,
        forwardRef(() => CoreModule),
        PriceModule,
        TokensModule,
        forwardRef(() => MarketModule),
        forwardRef(() => PortfolioModule),
        FaucetModule,
    ],
    controllers: [OrdersController],
    providers: [
        OrdersService,
        OrderRepository,
        MatchRepository,
        OrdersWorker,
        WalletThrottlerGuard,
    ],
    exports: [OrdersService, OrderRepository, MatchRepository],
})
export class OrdersModule {}
