import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { ThrottlerModule } from "@nestjs/throttler";
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
import { WithdrawModule } from "./withdraw/withdraw.module";
import { ChainIndexerModule } from "./chain-indexer/chain-indexer.module";
import { CollateralModule } from "./collateral/collateral.module";
import { HealthModule } from "./health/health.module";
import { EventsGateway } from "./core/websocket/websocket.gateway";

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            envFilePath: [".env.contracts", ".env"],
        }),
        ScheduleModule.forRoot(),
        ThrottlerModule.forRoot([
            {
                name: "short",
                ttl: 1000,
                limit: 5,
            },
            {
                name: "long",
                ttl: 60000,
                limit: 60,
            },
        ]),
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
        ChainIndexerModule,
        CollateralModule,
        HealthModule,
    ],
    controllers: [],
    providers: [],
})
export class AppModule {}
