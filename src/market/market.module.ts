import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MarketController } from './market.controller';
import { MarketService } from './market.service';
import { Market } from './entities/market.entity';
import { TokensModule } from '../tokens/tokens.module';
import { CoreModule } from '../core/core.module';
import { Token } from '../tokens/entities/token.entity';
import { PriceModule } from '../price/price.module';
import { OrdersModule } from '../orders/orders.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([Market, Token]),
        TokensModule,
        CoreModule,
        PriceModule,
        OrdersModule,
    ],
    controllers: [MarketController],
    providers: [
        MarketService,
    ],
    exports: [MarketService],
})
export class MarketModule { }

