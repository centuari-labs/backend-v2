import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ScheduleModule } from "@nestjs/schedule";
import { ThrottlerModule } from "@nestjs/throttler";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthModule } from "./auth/auth.module";
import { WalletThrottlerGuard } from "./common/guards/wallet-throttler.guard";
import { CoreModule } from "./core/core.module";
import { OrdersModule } from "./orders/orders.module";
import { PriceModule } from "./price/price.module";
import { TokensModule } from "./tokens/tokens.module";
import { MarketModule } from "./market/market.module";
import { PortfolioModule } from "./portfolio/portfolio.module";
import { FaucetModule } from "./faucet/faucet.module";
import { DepositModule } from "./deposit/deposit.module";
import { WithdrawModule } from "./withdraw/withdraw.module";
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
        CollateralModule,
        HealthModule,
    ],
    controllers: [],
    providers: [
        // Default-on rate limiting for every HTTP route. Tracker resolves to
        // the authenticated wallet (post-AuthGuard) and falls back to req.ip
        // when no wallet is in scope. Endpoints that need looser limits
        // override with @Throttle(); endpoints that need none use
        // @SkipThrottle().
        { provide: APP_GUARD, useClass: WalletThrottlerGuard },
    ],
})
export class AppModule {}
