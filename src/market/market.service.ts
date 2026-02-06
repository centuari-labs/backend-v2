import { Injectable, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MarketResponseDto } from './dto/market.dto';
import { Order } from '../orders/entities/order.entity';
import { OrderSide, OrderStatus } from '../orders/constants/order.constants';
import { Token } from '../tokens/entities/token.entity';
import { PRICE_PROVIDER } from './price-provider.interface';
import type { PriceProvider } from './price-provider.interface';

@Injectable()
export class MarketService {
    constructor(
        @InjectRepository(Order)
        private readonly orderRepository: Repository<Order>,
        @InjectRepository(Token)
        private readonly tokenRepository: Repository<Token>,
        @Inject(PRICE_PROVIDER)
        private readonly priceProvider: PriceProvider,
    ) { }





    async getMarketSnapshot(): Promise<MarketResponseDto> {
        const assets = await this.tokenRepository.find();

        const topRates = await this.orderRepository
            .createQueryBuilder('order')
            .select('order.assetId', 'assetId')
            .addSelect('order.side', 'side')
            .addSelect('MAX(order.rate)', 'maxRate')
            .where('order.status = :status', { status: OrderStatus.Open })
            .groupBy('order.assetId')
            .addGroupBy('order.side')
            .getRawMany();

        const rateMap = new Map<string, { borrow: number; lend: number }>();
        for (const rate of topRates) {
            if (!rateMap.has(rate.assetId)) {
                rateMap.set(rate.assetId, { borrow: 0, lend: 0 });
            }
            const entry = rateMap.get(rate.assetId)!;
            if (rate.side === OrderSide.Borrow) entry.borrow = Number.parseFloat(rate.maxRate);
            if (rate.side === OrderSide.Lend) entry.lend = Number.parseFloat(rate.maxRate);
        }

        // Batch fetch prices
        const symbols = assets.map(a => a.symbol);
        const priceMap = await this.priceProvider.getPrices(symbols);

        let totalDepositUSD = 0;
        let activeLoansUSD = 0;

        const openOrders = await this.orderRepository.find({
            where: { status: OrderStatus.Open }
        });

        for (const order of openOrders) {
            const asset = assets.find(a => a.id === order.assetId);
            if (!asset) continue;

            const price = priceMap.get(asset.symbol.toUpperCase());

            // Explicitly handle missing price: do not use fallback, just skip or treat as 0
            if (price !== null && price !== undefined) {
                const valueUSD = Number.parseFloat(order.quantity) * price;
                if (order.side === OrderSide.Lend) {
                    totalDepositUSD += valueUSD;
                } else {
                    activeLoansUSD += valueUSD;
                }
            }
        }

        const markets = assets.map(asset => {
            const rates = rateMap.get(asset.id) || { borrow: 0, lend: 0 };
            return {
                asset: {
                    name: asset.name,
                    symbol: asset.symbol,
                },
                borrow_rate: rates.borrow,
                lend_rate: rates.lend,
                collateral_factor: Number.parseFloat((asset.averageLTV ?? 0).toString()),
            };
        });

        return {
            total_deposit: totalDepositUSD.toFixed(2),
            active_loans: activeLoansUSD.toFixed(2),
            markets,
        };
    }

}
