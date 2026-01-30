import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MarketController } from './market.controller';
import { MarketService } from './market.service';
import { Market } from './entities/market.entity';
import { TokensModule } from '../tokens/tokens.module';
import { Order } from '../orders/entities/order.entity';
// import { Portfolio } from '../analytics/entities/portfolio.entity';
// import { BorrowPosition } from '../analytics/entities/borrow-position.entity';
import { CoreModule } from '../core/core.module';
import { Token } from '../tokens/entities/token.entity';

@Module({
    imports: [
        TypeOrmModule.forFeature([Market, Order, Token]),
        TokensModule,
        CoreModule,
    ],
    controllers: [MarketController],
    providers: [MarketService],
    exports: [MarketService],
})
export class MarketModule { }



