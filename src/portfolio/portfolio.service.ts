import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Token } from "../tokens/entities/token.entity";
import { PriceService } from "../price/price.service";
import { MyPortfolioResponseDto, GetMyAssetsQueryDto, MyAssetsResponseDto, LendBorrowAssetResponseDto, GetMyPositionResponseDto, MyPositionQueryDto } from "./dto/portfolio.dto";
import { PortfolioRepository } from "./repositories/portfolio.repository";
import { OrderRepository } from "../orders/repositories/order.repository";
import { calculateUsdAmount, createPaginatedResponse } from "./helpers/position.helpers";
import { buildPriceMapForAssets } from "./helpers/price.helper";

@Injectable()
export class PortfolioService {
    constructor(
        @InjectRepository(Token)
        private readonly tokenRepository: Repository<Token>,
        private readonly priceService: PriceService,
        private readonly portfolioRepository: PortfolioRepository,
        private readonly orderRepository: OrderRepository,
    ) { }

    async getMyPortfolio(wallet: string): Promise<MyPortfolioResponseDto> {
        const account = await this.orderRepository.findAccountByWallet(wallet);
        if (!account) {
            return {
                totalDeposit: "0.00",
                netAPY: 0,
                allTimeReturn: 0,
            };
        }

        const assets = await this.tokenRepository.find();
        const priceMap = new Map<string, number>();
        await Promise.all(
            assets.map(async (asset) => {
                const price = await this.priceService.getPrice(asset.tokenAddress);
                if (price !== null) {
                    priceMap.set(asset.id, price);
                }
            })
        );

        let totalBalanceUsd = 0;
        let totalNetAPY = 0;

        const portfolio = await this.portfolioRepository.getUserTotalBalances(account.id);
        const netAPY = await this.portfolioRepository.getUserNetAPY(account.id);

        for (const deposit of portfolio) {
            const price = priceMap.get(deposit.asset_id);
            if (price !== undefined) {
                totalBalanceUsd += Number.parseFloat(deposit.total_amount) * price;
            }
        }

        // Calculate average APY weighted by amount or just simple average for now
        if (netAPY.length > 0) {
            const sumAPY = netAPY.reduce((sum, item) => sum + Number.parseFloat(item.net_apy), 0);
            totalNetAPY = sumAPY / netAPY.length;
        }

        return {
            totalDeposit: totalBalanceUsd.toFixed(2),
            netAPY: Number(totalNetAPY.toFixed(2)),
            allTimeReturn: 0, // Placeholder as actual all-time return logic depends on history
        };
    }

    async getLendBorrowAssets(wallet: string): Promise<LendBorrowAssetResponseDto> {
        const account = await this.orderRepository.findAccountByWallet(wallet);
        if (!account) {
            return {
                suppliedAssets: "0.00",
                borrowedAssets: 0.00,
                healthFactor: 0,
            };
        }

        const assets = await this.tokenRepository.find();
        const priceMap = new Map<string, number>();
        await Promise.all(
            assets.map(async (asset) => {
                const price = await this.priceService.getPrice(asset.tokenAddress);
                if (price !== null) {
                    priceMap.set(asset.id, price);
                }
            })
        );

        let suppliedAmountUsd = 0;
        let borrowedAmountUsd = 0;

        const suppliedAssets = await this.portfolioRepository.getUserSuppliedAssets(account.id);
        const borrowedAssets = await this.portfolioRepository.getUserBorrowedAssets(account.id);

        for (const asset of suppliedAssets) {
            const price = priceMap.get(asset.asset_id);
            if (price !== undefined) {
                suppliedAmountUsd += Number.parseFloat(asset.amount) * price;
            }
        }

        for (const asset of borrowedAssets) {
            const price = priceMap.get(asset.asset_id);
            if (price !== undefined) {
                borrowedAmountUsd += Number.parseFloat(asset.amount) * price;
            }
        }

        const healthFactorValue = borrowedAmountUsd > 0 ? (suppliedAmountUsd / borrowedAmountUsd) : 0;

        return {
            suppliedAssets: suppliedAmountUsd.toFixed(2),
            borrowedAssets: Number(borrowedAmountUsd.toFixed(2)),
            healthFactor: Number(healthFactorValue.toFixed(2)),
        };
    }

    async getMyAssets(wallet: string, query: GetMyAssetsQueryDto): Promise<MyAssetsResponseDto> {
        const { page = 1, limit = 10 } = query;

        const account = await this.orderRepository.findAccountByWallet(wallet);
        if (!account) {
            return createPaginatedResponse([], 0, page, limit);
        }

        const { data: userAssets, total } = await this.portfolioRepository.getUserAssets(
            account.id,
            page,
            limit
        );

        if (userAssets.length === 0) {
            return createPaginatedResponse([], total, page, limit);
        }

        const assetIds = userAssets.map((ua) => ua.asset_id);
        const priceMap = await buildPriceMapForAssets(
            assetIds,
            this.priceService,
            this.tokenRepository
        );

        const tokens = await this.tokenRepository
            .createQueryBuilder('token')
            .where('token.id IN (:...assetIds)', { assetIds })
            .getMany();

        const tokenMap = new Map(tokens.map((t) => [t.id, t]));

        const data = userAssets.map((ua) => {
            const token = tokenMap.get(ua.asset_id);
            const price = priceMap.get(ua.asset_id);
            const amount = Number.parseFloat(ua.amount);

            return {
                symbol: token?.symbol || "UNKNOWN",
                name: token?.name || "Unknown Token",
                walletBalance: amount.toString(),
                amountInUsd: calculateUsdAmount(amount, price),
                isCollateral: ua.is_collateral,
            };
        });

        return createPaginatedResponse(data, total, page, limit);
    }

    async getMyPosition(wallet: string, query: MyPositionQueryDto): Promise<GetMyPositionResponseDto> {
        const { page = 1, limit = 10, type } = query;

        const account = await this.orderRepository.findAccountByWallet(wallet);
        if (!account) {
            return createPaginatedResponse([], 0, page, limit);
        }

        const { data: positions, total } = await this.portfolioRepository.getUserPositions(
            account.id,
            type,
            page,
            limit
        );

        if (positions.length === 0) {
            return createPaginatedResponse([], total, page, limit);
        }

        const assetIds = positions.map((p) => p.asset_id);
        const priceMap = await buildPriceMapForAssets(
            assetIds,
            this.priceService,
            this.tokenRepository
        );

        const data = positions.map((position) => {
            const price = priceMap.get(position.asset_id);
            const remainingQuantity = Number.parseFloat(position.quantity) - Number.parseFloat(position.filled_quantity);

            return {
                symbol: position.symbol,
                name: position.name,
                walletBalance: remainingQuantity.toString(),
                amountInUsd: calculateUsdAmount(remainingQuantity, price),
                isCollateral: false,
            };
        });

        return createPaginatedResponse(data, total, page, limit);
    }

}
