import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MarketResponseDto } from './dto/market.dto';
import { Token } from '../tokens/entities/token.entity';
import { PriceService } from '../price/price.service';

import { OrderRepository } from '../orders/repositories/order.repository';
import { MarketRepositories } from './repository/market.repository';
import { toPercentage } from '../common/utils/number.utils';

@Injectable()
export class MarketService {
    constructor(
        private readonly orderRepository: OrderRepository,
        private readonly marketRepository: MarketRepositories,
        @InjectRepository(Token)
        private readonly tokenRepository: Repository<Token>,
        private readonly priceService: PriceService,
    ) { }

    async getMarketSnapshot(): Promise<MarketResponseDto> {
        const assets = await this.tokenRepository.find();

        const rateMap = await this.orderRepository.getBestRates();

        const priceMap = new Map<string, number>();
        await Promise.all(
            assets.map(async (asset) => {
                const price = await this.priceService.getPrice(asset.id);
                if (price !== null) {
                    priceMap.set(asset.id.toLowerCase(), price);
                }
            })
        );

        let totalDepositUSD = 0;
        let activeLoansUSD = 0;

        const portfolioDeposits = await this.marketRepository.getTotalDepositUsd();
        const lendPositions = await this.marketRepository.getActiveLoans();

        for (const deposit of portfolioDeposits) {
            const asset = assets.find(a => a.id === deposit.asset_id);
            if (!asset) continue;

            const price = priceMap.get(asset.id.toLowerCase());
            if (price !== undefined) {
                totalDepositUSD += Number.parseFloat(deposit.total_amount) * price;
            }
        }

        for (const loan of lendPositions) {
            const asset = assets.find(a => a.id === loan.asset_id);
            if (!asset) continue;

            const price = priceMap.get(asset.id.toLowerCase());
            if (price !== undefined) {
                activeLoansUSD += Number.parseFloat(loan.total_amount) * price;
            }
        }

        const markets = assets.map(asset => {
            const rates = rateMap.get(asset.id) || { borrow: 0, lend: 0 };
            return {
                asset: {
                    id: asset.id,
                    name: asset.name,
                    symbol: asset.symbol,
                    decimals: asset.decimals ?? null,
                    image_url: asset.imageUrl ?? null,
                },
                markets: { //@todo : should return the earliest market id of maturity available of the assets
                    market_id: this.marketRepository.getMarketId(asset.id),
                    maturity: new Date().toISOString(),
                },
                // rates in DB are stored as basis points; convert to human percentage for responses
                borrow_rate: toPercentage(rates.borrow),
                lend_rate: toPercentage(rates.lend),
                // averageLTV is stored as basis points on the token entity
                collateral_factor: toPercentage(asset.averageLTV),
            };
        });

        return {
            total_deposit: totalDepositUSD.toFixed(2),
            active_loans: activeLoansUSD.toFixed(2),
            markets,
        };
    }

}
