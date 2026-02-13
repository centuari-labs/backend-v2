import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Token } from "../tokens/entities/token.entity";
import { PriceService } from "../price/price.service";
import { MyPortfolioResponseDto, GetMyAssetsQueryDto, MyAssetsResponseDto, LendBorrowAssetResponseDto, GetMyPositionResponseDto, MyPositionQueryDto } from "./dto/portfolio.dto";
import { PortfolioRepository } from "./repositories/portfolio.repository";
import { OrderRepository } from "../orders/repositories/order.repository";
import { calculateUsdAmount, createPaginatedResponse } from "./helpers/position.helpers";

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
            throw new NotFoundException("Account not found");
        }

        const assets = await this.tokenRepository.find();
        const allPrices = this.priceService.getPrices();
        const priceMap = new Map<string, number>();

        for (const asset of assets) {
            const price = allPrices[asset.tokenAddress.toLowerCase()];
            if (price !== undefined) {
                priceMap.set(asset.id, price);
            }
        }

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
            totalDeposit: totalBalanceUsd,
            netAPY: Number(totalNetAPY.toFixed(2)),
            allTimeReturn: 0,
        };
    }

    async getLendBorrowAssets(wallet: string): Promise<LendBorrowAssetResponseDto> {
        const account = await this.orderRepository.findAccountByWallet(wallet);
        if (!account) {
            throw new NotFoundException("Account not found");
        }

        const assets = await this.tokenRepository.find();
        const allPrices = this.priceService.getPrices();
        const priceMap = new Map<string, number>();

        for (const asset of assets) {
            const price = allPrices[asset.tokenAddress.toLowerCase()];
            if (price !== undefined) {
                priceMap.set(asset.id, price);
            }
        }

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
            suppliedAssets: suppliedAmountUsd,
            borrowedAssets: borrowedAmountUsd,
            healthFactor: healthFactorValue,
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
        const tokens = await this.tokenRepository
            .createQueryBuilder('token')
            .where('token.id IN (:...assetIds)', { assetIds })
            .getMany();

        const tokenMap = new Map(tokens.map((t) => [t.id, t]));
        const allPrices = this.priceService.getPrices();

        const data = userAssets.map((ua) => {
            const token = tokenMap.get(ua.asset_id);
            const price = token ? allPrices[token.tokenAddress.toLowerCase()] : undefined;
            const amount = Number.parseFloat(ua.amount);

            return {
                symbol: token?.symbol || "UNKNOWN",
                name: token?.name || "Unknown Token",
                walletBalance: amount,
                amountInUsd: calculateUsdAmount(amount, price ?? 0),
                isCollateral: !!ua.is_collateral,
            };
        });

        return createPaginatedResponse(data, total, page, limit);
    }

    async getMyPosition(wallet: string, query: MyPositionQueryDto): Promise<GetMyPositionResponseDto> {
        const { page = 1, limit = 10, type } = query;

        const account = await this.orderRepository.findAccountByWallet(wallet);
        if (!account) {
            throw new NotFoundException("Account not found");
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

        const allPrices = this.priceService.getPrices();

        const data = positions.map((position) => {
            const price = allPrices[position.token_address?.toLowerCase()];
            const quantity = Number.parseFloat(position.quantity);

            return {
                symbol: position.symbol,
                name: position.name,
                walletBalance: quantity,
                amountInUsd: calculateUsdAmount(quantity, price ?? 0),
                isCollateral: false,
            };
        });

        return createPaginatedResponse(data, total, page, limit);
    }

}
