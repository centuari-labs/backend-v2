import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthModule } from "./auth/auth.module";
import { CoreModule } from "./core/core.module";
import { OrdersModule } from "./orders/orders.module";
import { PriceModule } from "./price/price.module";
import { TokensModule } from "./tokens/tokens.module";
import { MarketModule } from "./market/market.module";
import { PortfolioModule } from "./portfolio/portfolio.module";
import { FaucetModule } from "./faucet/faucet.module";
import { DepositModule } from "./deposit/deposit.module";
import { RateModule } from "./rate-history/rate-history.module";
import { RepayModule } from "./repay/repay.module";
import { WithdrawModule } from "./withdraw/withdraw.module";
import { ChainIndexerModule } from "./chain-indexer/chain-indexer.module";
import { LendPositionsModule } from "./lendPositions/lend-positions.module";
import { EventsGateway } from "./core/websocket/websocket.gateway";

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
        }),
        ScheduleModule.forRoot(),
        TypeOrmModule.forRoot({
            type: "postgres",
            url: process.env.DATABASE_URL,
            autoLoadEntities: true,
            synchronize: false,
            logging: ["error"],
        }),
        AuthModule,
        CoreModule,
        OrdersModule,
        PriceModule,
        TokensModule,
        MarketModule,
        PortfolioModule,
        FaucetModule,
        DepositModule,
        WithdrawModule,
        RepayModule,
        RateModule,
        ChainIndexerModule,
        LendPositionsModule,
    ],
    controllers: [],
    providers: [EventsGateway],
})
export class AppModule {}
