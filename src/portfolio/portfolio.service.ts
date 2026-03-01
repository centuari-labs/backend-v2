import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Token } from "../tokens/entities/token.entity";
import { PriceService } from "../price/price.service";
import { TokensService } from "../tokens/tokens.service";
import { MyPortfolioResponseDto, GetMyAssetsQueryDto, MyAssetsResponseDto, LendBorrowAssetResponseDto, GetMyPositionResponseDto, MyPositionQueryDto, SetAssetAsCollateralDto, MyHealthFactorResponseDto } from "./dto/portfolio.dto";
import { PortfolioRepository } from "./repositories/portfolio.repository";
import { OrderRepository } from "../orders/repositories/order.repository";
import { calculateUsdAmount, createPaginatedResponse } from "./helpers/position.helpers";
import { baseUnitsToHuman } from "../common/utils/number.utils";
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
        private readonly tokensService: TokensService,
        private readonly portfolioRepository: PortfolioRepository,
        private readonly orderRepository: OrderRepository,
    ) { }

    async getMyPortfolio(wallet: string): Promise<MyPortfolioResponseDto> {
        const account = await this.orderRepository.findAccountByWallet(wallet);
        if (!account) {
            throw new NotFoundException("Account not found");
        }

        const allPrices = this.priceService.getPrices();

        let totalBalanceUsd = 0;

        const [portfolio, lendPositions, suppliedAssets, borrowedAssets] = await Promise.all([
            this.portfolioRepository.getUserTotalBalances(account.id),
            this.portfolioRepository.getUserLendPositionsForApr(account.id),
            this.portfolioRepository.getUserSuppliedAssets(account.id),
            this.portfolioRepository.getUserBorrowedAssets(account.id),
        ]);

        for (const deposit of portfolio) {
            const price = allPrices[deposit.asset_id.toLowerCase()];
            if (price !== undefined) {
                totalBalanceUsd += Number.parseFloat(deposit.total_amount) * price;
            }
        }

        let netAPR = 0;
        let allTimeReturnUsd = 0;
        if (lendPositions.length > 0) {
            let totalWeightedAPR = 0;
            let totalAmount = 0;

            for (const position of lendPositions) {
                const decimals = await this.tokensService.getTokenDecimalsByAssetId(position.asset_id);
                if (decimals == null) continue;

                const amountHuman = Number(baseUnitsToHuman(position.amount, decimals));
                const sharesHuman = Number(baseUnitsToHuman(position.shares, decimals));

                if (amountHuman <= 0) continue;

                const apr = sharesHuman / amountHuman - 1;
                totalWeightedAPR += apr * amountHuman;
                totalAmount += amountHuman;

                const price = allPrices[position.asset_id.toLowerCase()];
                if (price !== undefined) {
                    const gainHuman = sharesHuman - amountHuman;
                    allTimeReturnUsd += gainHuman * price;
                }
            }

            if (totalAmount > 0) {
                netAPR = totalWeightedAPR / totalAmount;
            }
        }

        let suppliedAssetsUsd = 0;
        for (const position of suppliedAssets) {
            const decimals = await this.tokensService.getTokenDecimalsByAssetId(position.asset_id);
            if (decimals == null) continue;
            const amountHuman = Number(baseUnitsToHuman(position.amount, decimals));
            if (amountHuman <= 0) continue;

            const price = allPrices[position.asset_id.toLowerCase()];
            if (price === undefined) continue;

            suppliedAssetsUsd += amountHuman * price;
        }

        let borrowedAssetsUsd = 0;
        for (const position of borrowedAssets) {
            const decimals = await this.tokensService.getTokenDecimalsByAssetId(position.asset_id);
            if (decimals == null) continue;
            const amountHuman = Number(baseUnitsToHuman(position.amount, decimals));
            if (amountHuman <= 0) continue;

            const price = allPrices[position.asset_id.toLowerCase()];
            if (price === undefined) continue;

            borrowedAssetsUsd += amountHuman * price;
        }

        const availableBalanceUsdRaw = totalBalanceUsd - suppliedAssetsUsd;
        const availableBalanceUsd = availableBalanceUsdRaw > 0 ? availableBalanceUsdRaw : 0;

        const allocationTotalUsd = availableBalanceUsd + suppliedAssetsUsd + borrowedAssetsUsd;

        let availableBalancePct = 0;
        let suppliedAssetsPct = 0;
        let borrowedAssetsPct = 0;

        if (allocationTotalUsd > 0) {
            availableBalancePct = (availableBalanceUsd / allocationTotalUsd) * 100;
            suppliedAssetsPct = (suppliedAssetsUsd / allocationTotalUsd) * 100;
            borrowedAssetsPct = (borrowedAssetsUsd / allocationTotalUsd) * 100;
        }

        return {
            totalDeposit: totalBalanceUsd,
            allTimeReturn: Number(allTimeReturnUsd.toFixed(2)),
            netAPY: Number((netAPR * 100).toFixed(2)),
            allocation: {
                availableBalanceUsd: Number(availableBalanceUsd.toFixed(2)),
                suppliedAssetsUsd: Number(suppliedAssetsUsd.toFixed(2)),
                borrowedAssetsUsd: Number(borrowedAssetsUsd.toFixed(2)),
                availableBalancePct: Number(availableBalancePct.toFixed(2)),
                suppliedAssetsPct: Number(suppliedAssetsPct.toFixed(2)),
                borrowedAssetsPct: Number(borrowedAssetsPct.toFixed(2)),
            },
        };
    }

    async getLendBorrowAssets(wallet: string): Promise<LendBorrowAssetResponseDto> {
        const account = await this.orderRepository.findAccountByWallet(wallet);
        if (!account) {
            throw new NotFoundException("Account not found");
        }

        const [result, suppliedAssets, borrowedAssets] = await Promise.all([
            this.getHealthFactorForAccount(account.id),
            this.portfolioRepository.getUserSuppliedAssets(account.id),
            this.portfolioRepository.getUserBorrowedAssets(account.id),
        ]);
        const formatted = formatHealthFactorResponse(result);
        const allPrices = this.priceService.getPrices();

        let suppliedAssetsUsd = 0;
        for (const position of suppliedAssets) {
            const decimals = await this.tokensService.getTokenDecimalsByAssetId(position.asset_id);
            if (decimals == null) continue;
            const amountHuman = Number(baseUnitsToHuman(position.amount, decimals));
            if (amountHuman <= 0) continue;
            const price = allPrices[position.asset_id.toLowerCase()];
            if (price === undefined) continue;
            suppliedAssetsUsd += amountHuman * price;
        }

        let borrowedAssetsUsd = 0;
        for (const position of borrowedAssets) {
            const decimals = await this.tokensService.getTokenDecimalsByAssetId(position.asset_id);
            if (decimals == null) continue;
            const amountHuman = Number(baseUnitsToHuman(position.amount, decimals));
            if (amountHuman <= 0) continue;
            const price = allPrices[position.asset_id.toLowerCase()];
            if (price === undefined) continue;
            borrowedAssetsUsd += amountHuman * price;
        }

        return {
            suppliedAssets: Number(suppliedAssetsUsd.toFixed(2)),
            borrowedAssets: Number(borrowedAssetsUsd.toFixed(2)),
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
            const amount = Number.parseFloat(ua.amount); //@todo : convert this to human readable from assets decimal
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
