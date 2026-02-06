import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MarketResponseDto } from './dto/market.dto';
import { Order } from '../orders/entities/order.entity';
import { OrderSide, OrderStatus } from '../orders/constants/order.constants';
import { Token } from '../tokens/entities/token.entity';
import { PriceService } from '../price/price.service';

@Injectable()
export class MarketService {
    constructor(
        @InjectRepository(Order)
        private readonly orderRepository: Repository<Order>,
        @InjectRepository(Token)
        private readonly tokenRepository: Repository<Token>,
        private readonly priceService: PriceService,
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

        const priceMap = new Map<string, number>();
        await Promise.all(
            assets.map(async (asset) => {
                const price = await this.priceService.getPrice(asset.tokenAddress);
                if (price !== null) {
                    priceMap.set(asset.tokenAddress.toLowerCase(), price);
                }
            })
        );

        let totalDepositUSD = 0;
        let activeLoansUSD = 0;

        const openOrders = await this.orderRepository.find({
            where: { status: OrderStatus.Open }
        });

        for (const order of openOrders) {
            const asset = assets.find(a => a.id === order.assetId);
            if (!asset) continue;

            const price = priceMap.get(asset.tokenAddress.toLowerCase());

            if (price !== undefined) {
                const valueUSD = Number.parseFloat(order.quantity) * price;
                if (order.side === OrderSide.Lend) {
                    totalDepositUSD += valueUSD;
                } else {
                    activeLoansUSD += valueUSD;
                }
            }
        }

        let markets = assets.map(asset => {
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
