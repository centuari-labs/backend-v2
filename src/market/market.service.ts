import { Injectable, NotFoundException } from "@nestjs/common";
import { MarketDetailResponseDto, MarketResponseDto } from "./dto/market.dto";
import { RateHistoryDataDto } from "./dto/rate-history.dto";
import { PriceService } from "../price/price.service";

import { OrderRepository } from "../orders/repositories/order.repository";
import { MarketRepositories } from "./repository/market.repository";
import { RateRepository } from "./repository/rate-history.repository";
import { TokensRepository } from "../tokens/repositories/tokens.repository";
import { toPercentage } from "../common/utils/number.utils";

@Injectable()
export class MarketService {
    constructor(
        private readonly orderRepository: OrderRepository,
        private readonly marketRepository: MarketRepositories,
        private readonly rateRepository: RateRepository,
        private readonly tokensRepository: TokensRepository,
        private readonly priceService: PriceService,
    ) {}

    async getMarketSnapshot(): Promise<MarketResponseDto> {
        const assets = await this.tokensRepository.findLoanTokens();

        const rateMap = await this.orderRepository.getBestRates();

        const priceMap = new Map<string, number>();
        await Promise.all(
            assets.map(async (asset) => {
                const price = await this.priceService.getPrice(asset.id);
                if (price !== null) {
                    priceMap.set(asset.id.toLowerCase(), price);
                }
            }),
        );

        let totalDepositUSD = 0;
        let activeLoansUSD = 0;

        const portfolioDeposits =
            await this.marketRepository.getTotalDepositUsd();
        const lendPositions = await this.marketRepository.getActiveLoans();

        for (const deposit of portfolioDeposits) {
            const asset = assets.find((a) => a.id === deposit.asset_id);
            if (!asset || !asset.decimals) continue;

            const price = priceMap.get(asset.id.toLowerCase());
            if (price !== undefined) {
                const humanAmount =
                    Number.parseFloat(deposit.total_amount) /
                    10 ** asset.decimals;
                totalDepositUSD += humanAmount * price;
            }
        }

        for (const loan of lendPositions) {
            const asset = assets.find((a) => a.id === loan.asset_id);
            if (!asset || !asset.decimals) continue;

            const price = priceMap.get(asset.id.toLowerCase());
            if (price !== undefined) {
                const humanAmount =
                    Number.parseFloat(loan.total_amount) / 10 ** asset.decimals;
                activeLoansUSD += humanAmount * price;
            }
        }

        const now = new Date();
        const minMaturity = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

        const assetIds = assets.map((a) => a.id);
        const earliestMarkets =
            await this.marketRepository.getEarliestMarketByAssetIds(
                assetIds,
                minMaturity,
            );
        const earliestByAsset = new Map(
            earliestMarkets.map((m) => [
                m.assetId,
                { marketId: m.marketId, maturity: m.maturity },
            ]),
        );

        const markets = assets.map((asset) => {
            const rates = rateMap.get(asset.id) || { borrow: 0, lend: 0 };
            const earliest = earliestByAsset.get(asset.id);
            return {
                asset: {
                    id: asset.id,
                    name: asset.name,
                    symbol: asset.symbol,
                    decimals: asset.decimals ?? null,
                    image_url: asset.imageUrl ?? null,
                },
                market: {
                    market_id: earliest?.marketId ?? null,
                    maturity: earliest
                        ? Math.floor(earliest.maturity.getTime() / 1000)
                        : null,
                },
                // rates in DB are stored as basis points; convert to human percentage for responses
                borrow_rate: toPercentage(rates.lend),
                lend_rate: toPercentage(rates.borrow),
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

    async getMarketDetail(assetId: string): Promise<MarketDetailResponseDto> {
        const asset = await this.tokensRepository.findByAssetId(assetId);
        if (!asset) {
            throw new NotFoundException(`Asset with ID ${assetId} not found`);
        }

        const price = await this.priceService.getPrice(assetId);
        const rateMap = await this.orderRepository.getBestRates();
        const rates = rateMap.get(assetId) || { borrow: 0, lend: 0 };

        const rawDeposit =
            await this.marketRepository.getSumDepositByAssetId(assetId);
        const rawLoans =
            await this.marketRepository.getSumLoansByAssetId(assetId);

        let totalDepositUSD = 0;
        let activeLoansUSD = 0;

        if (price !== null && asset.decimals) {
            totalDepositUSD =
                (Number.parseFloat(rawDeposit) / 10 ** asset.decimals) * price;
            activeLoansUSD =
                (Number.parseFloat(rawLoans) / 10 ** asset.decimals) * price;
        }

        const now = new Date();
        const minMaturity = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

        const upcomingMarkets = await this.marketRepository.getUpcomingMarkets(
            assetId,
            3,
            minMaturity,
        );
        return {
            asset: {
                id: asset.id,
                name: asset.name,
                symbol: asset.symbol,
                decimals: asset.decimals ?? null,
                imageUrl: asset.imageUrl ?? null,
            },
            collateral_factor: toPercentage(asset.averageLTV),
            total_deposit: totalDepositUSD.toFixed(2),
            active_loans: activeLoansUSD.toFixed(2),
            upcoming_maturities: upcomingMarkets.map((m) => ({
                market_id: m.id,
                maturity: Math.floor(new Date(m.maturity).getTime() / 1000),
            })),
        };
    }

    async getRateHistory(assetId: string): Promise<RateHistoryDataDto> {
        const rateHistory =
            await this.rateRepository.getRateHistoryByAssetId(assetId);

        return {
            assetId,
            rateHistory: rateHistory.map((item) => ({
                date: item.date,
                rate: toPercentage(item.rate),
            })),
        };
    }
}
