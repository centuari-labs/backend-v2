import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MarketController } from './market.controller';
import { MarketService } from './market.service';
import { Market } from './entities/market.entity';
import { TokensModule } from '../tokens/tokens.module';
import { Order } from '../orders/entities/order.entity';
import { CoreModule } from '../core/core.module';
import { Token } from '../tokens/entities/token.entity';
import { PRICE_PROVIDER } from './price-provider.interface';
import { InternalPriceProvider } from './internal-price.provider';

@Module({
    imports: [
        TypeOrmModule.forFeature([Market, Order, Token]),
        TokensModule,
        CoreModule,
    ],
    controllers: [MarketController],
    providers: [
        MarketService,
        {
            provide: PRICE_PROVIDER,
            useClass: InternalPriceProvider,
        },
    ],
    exports: [MarketService, PRICE_PROVIDER],
})
export class MarketModule { }
