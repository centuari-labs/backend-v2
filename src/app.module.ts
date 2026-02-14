import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthModule } from "./auth/auth.module";
import { CoreModule } from "./core/core.module";
import { OrdersModule } from "./orders/orders.module";
import { PriceModule } from "./price/price.module";
import { TokensModule } from "./tokens/tokens.module";
import { MarketModule } from "./market/market.module";
import { PortfolioModule } from "./portfolio/portfolio.module";

@Module({
    imports: [
        ScheduleModule.forRoot(),
        TypeOrmModule.forRoot({
            type: "postgres",
            url: process.env.DATABASE_URL,
            autoLoadEntities: true,
            synchronize: false,
            logging: process.env.NODE_ENV === "development",
        }),
        AuthModule,
        CoreModule,
        OrdersModule,
        PriceModule,
        TokensModule,
        MarketModule,
        PortfolioModule,
    ],
    controllers: [AppController],
    providers: [],
})
export class AppModule { }
