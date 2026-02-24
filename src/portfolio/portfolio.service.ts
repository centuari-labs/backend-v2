import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Token } from "../tokens/entities/token.entity";
import { PriceService } from "../price/price.service";
import { MyPortfolioResponseDto, GetMyAssetsQueryDto, MyAssetsResponseDto, LendBorrowAssetResponseDto, GetMyPositionResponseDto, MyPositionQueryDto, SetAssetAsCollateralDto, MyHealthFactorResponseDto } from "./dto/portfolio.dto";
import { PortfolioRepository } from "./repositories/portfolio.repository";
import { OrderRepository } from "../orders/repositories/order.repository";
import { calculateUsdAmount, createPaginatedResponse } from "./helpers/position.helpers";
import {
    computeHealthFactor,
    formatHealthFactorResponse,
    type CollateralPositionInput,
    type DebtPositionInput,
    type HealthFactorResult,
} from "./helpers/health-factor.helpers";

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
            const price = allPrices[asset.id.toLowerCase()];
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

        if (netAPY.length > 0) {
            const sumAPY = netAPY.reduce((sum, item) => sum + Number.parseFloat(item.net_apy), 0);
            totalNetAPY = sumAPY / netAPY.length;
        }

        //@todo : need to return user's all time return
        //@todo : need to return user's portofolio allocation percentages
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

        const result = await this.getHealthFactorForAccount(account.id);
        const formatted = formatHealthFactorResponse(result);
        return {
            suppliedAssets: formatted.collateralUsd, //@todo : change this to supplied lend assets
            borrowedAssets: formatted.debtUsd, //@todo : change this to total borrowed assets
            healthFactor: Number.isFinite(formatted.healthFactor) ? formatted.healthFactor : 0,
        };
    }

    /**
     * Returns health factor for the given account, optionally including a prospective extra debt position.
     * Used by GET my-health-factor and by borrow order validation.
     */
    async getHealthFactorForAccount(
        accountId: string,
        additionalDebt?: { assetId: string; amountBaseUnits: string },
    ): Promise<HealthFactorResult> {
        const { collateralPositions, debtPositions, additionalDebtPositions } =
            await this.buildHealthFactorInputs(accountId, additionalDebt);
        return computeHealthFactor(collateralPositions, debtPositions, additionalDebtPositions);
    }

    async getMyHealthFactor(wallet: string): Promise<MyHealthFactorResponseDto> {
        const account = await this.orderRepository.findAccountByWallet(wallet);
        if (!account) {
            throw new NotFoundException("Account not found");
        }

        const result = await this.getHealthFactorForAccount(account.id);
        return formatHealthFactorResponse(result);
    }

    private async buildHealthFactorInputs(
        accountId: string,
        additionalDebt?: { assetId: string; amountBaseUnits: string },
    ): Promise<{
        collateralPositions: CollateralPositionInput[];
        debtPositions: DebtPositionInput[];
        additionalDebtPositions?: DebtPositionInput[];
    }> {
        const [collateralRows, debtRows, tokens, allPrices] = await Promise.all([
            this.portfolioRepository.getUserCollateralAssets(accountId),
            this.portfolioRepository.getUserBorrowedAssets(accountId),
            this.tokenRepository.find(),
            Promise.resolve(this.priceService.getPrices()),
        ]);

        const tokenMap = new Map(tokens.map((t) => [t.id, t]));
        const priceMap = new Map<string, number>();
        for (const t of tokens) {
            const p = allPrices[t.id.toLowerCase()];
            if (p !== undefined) priceMap.set(t.id, p);
        }

        const collateralPositions: CollateralPositionInput[] = [];
        for (const row of collateralRows) {
            const token = tokenMap.get(row.asset_id);
            const decimals = token?.decimals ?? 0;
            const priceUsd = priceMap.get(row.asset_id) ?? 0;
            const ltvBps = token?.averageLTV != null ? Number(token.averageLTV) : 0;
            collateralPositions.push({
                assetId: row.asset_id,
                amountBaseUnits: row.amount,
                decimals,
                priceUsd,
                ltvBps,
            });
        }

        const debtPositions: DebtPositionInput[] = [];
        for (const row of debtRows) {
            const token = tokenMap.get(row.asset_id);
            const decimals = token?.decimals ?? 0;
            const priceUsd = priceMap.get(row.asset_id) ?? 0;
            debtPositions.push({
                assetId: row.asset_id,
                amountBaseUnits: row.amount,
                decimals,
                priceUsd,
            });
        }

        let additionalDebtPositions: DebtPositionInput[] | undefined;
        if (additionalDebt) {
            const token = tokenMap.get(additionalDebt.assetId);
            const decimals = token?.decimals ?? 0;
            const priceUsd = priceMap.get(additionalDebt.assetId) ?? 0;
            additionalDebtPositions = [
                {
                    assetId: additionalDebt.assetId,
                    amountBaseUnits: additionalDebt.amountBaseUnits,
                    decimals,
                    priceUsd,
                },
            ];
        }

        return { collateralPositions, debtPositions, additionalDebtPositions };
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
        //@todo : move this into repository
        const tokens = await this.tokenRepository
            .createQueryBuilder('token')
            .where('token.id IN (:...assetIds)', { assetIds })
            .getMany();

        const tokenMap = new Map(tokens.map((t) => [t.id, t]));
        const allPrices = this.priceService.getPrices();

        const data = userAssets.map((ua) => {
            const token = tokenMap.get(ua.asset_id);
            const price = allPrices[ua.asset_id.toLowerCase()];
            const amount = Number.parseFloat(ua.amount);
            //@todo : need to also return asset id, better use the same DTO for all asset type return
            return {
                symbol: token?.symbol || "UNKNOWN",
                name: token?.name || "Unknown Token",
                walletBalance: amount,
                amountInUsd: calculateUsdAmount(amount, price ?? 0),
                isCollateral: !!ua.is_collateral,
                imageUrl: token?.imageUrl ?? null,
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
            const price = allPrices[position.asset_id.toLowerCase()];
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

    async setAssetAsCollateral(wallet: string, body: SetAssetAsCollateralDto): Promise<void> {
        if (!body || !body.assetIds || !Array.isArray(body.assetIds) || body.assetIds.length === 0) {
            throw new Error("Invalid request body: assetIds array is required");
        }

        const account = await this.orderRepository.findAccountByWallet(wallet);
        if (!account) {
            throw new NotFoundException("Account not found");
        }

        await this.portfolioRepository.setAssetAsCollateral(account.id, body.assetIds, body.isCollateral);
    }

}
