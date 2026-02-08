import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MarketResponseDto } from './dto/market.dto';
import { OrderSide, OrderStatus } from '../orders/constants/order.constants';
import { Token } from '../tokens/entities/token.entity';
import { PriceService } from '../price/price.service';

import { OrderRepository } from '../orders/repositories/order.repository';
import { MarketRepositories } from './repository/market.repository';

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
                const price = await this.priceService.getPrice(asset.tokenAddress);
                if (price !== null) {
                    priceMap.set(asset.tokenAddress.toLowerCase(), price);
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

            const price = priceMap.get(asset.tokenAddress.toLowerCase());
            if (price !== undefined) {
                totalDepositUSD += Number.parseFloat(deposit.total_amount) * price;
            }
        }

        for (const loan of lendPositions) {
            const asset = assets.find(a => a.id === loan.asset_id);
            if (!asset) continue;

            const price = priceMap.get(asset.tokenAddress.toLowerCase());
            if (price !== undefined) {
                activeLoansUSD += Number.parseFloat(loan.total_amount) * price;
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
