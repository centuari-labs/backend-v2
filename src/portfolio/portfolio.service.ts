import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
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
    type HealthFactorOptions,
} from "./helpers/health-factor.helpers";
import { OrderSide, OrderStatus } from "../orders/constants/order.constants";

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
     * Returns health factor for the given account, optionally including a prospective extra debt position and open orders.
     * Used by GET my-health-factor and by borrow order validation.
     */
    async getHealthFactorForAccount(
        accountId: string,
        options?: HealthFactorOptions,
    ): Promise<HealthFactorResult> {
        const { collateralPositions, debtPositions, additionalDebtPositions } =
            await this.buildHealthFactorInputs(accountId, options);
        return computeHealthFactor(
            collateralPositions,
            debtPositions,
            additionalDebtPositions,
            options?.additionalBorrowUsd,
        );
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
        options?: HealthFactorOptions,
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

        const additionalDebtPositions: DebtPositionInput[] = [];

        if (options?.additionalDebt) {
            const token = tokenMap.get(options.additionalDebt.assetId);
            const decimals = token?.decimals ?? 0;
            const priceUsd = priceMap.get(options.additionalDebt.assetId) ?? 0;
            additionalDebtPositions.push({
                assetId: options.additionalDebt.assetId,
                amountBaseUnits: options.additionalDebt.amountBaseUnits,
                decimals,
                priceUsd,
            });
        }

        if (options?.includeOpenOrders) {
            const openOrders = await this.orderRepository.getOpenBorrowOrders(accountId);
            for (const order of openOrders) {
                const token = tokenMap.get(order.assetId);
                const decimals = token?.decimals ?? 0;
                const priceUsd = priceMap.get(order.assetId) ?? 0;

                const remainingAmountBaseUnits = (BigInt(order.quantity) - BigInt(order.filledQuantity)).toString();

                additionalDebtPositions.push({
                    assetId: order.assetId,
                    amountBaseUnits: remainingAmountBaseUnits,
                    decimals,
                    priceUsd,
                });
            }
        }

        return {
            collateralPositions,
            debtPositions,
            additionalDebtPositions: additionalDebtPositions.length > 0 ? additionalDebtPositions : undefined
        };
    }

    async calculateOpenBorrowOrdersUsd(accountId: string): Promise<number> {
        const openOrders = await this.orderRepository.getOpenBorrowOrders(accountId);
        let totalUsd = 0;
        const allPrices = this.priceService.getPrices();

        for (const order of openOrders) {
            const price = allPrices[order.assetId.toLowerCase()];
            const decimals = await this.tokensService.getTokenDecimalsByAssetId(order.assetId);
            if (price != null && decimals != null) {
                const remainingAmountHuman = Number(baseUnitsToHuman(
                    (BigInt(order.quantity) - BigInt(order.filledQuantity)).toString(),
                    decimals
                ));
                totalUsd += remainingAmountHuman * price;
            }
        }

        return totalUsd;
    }

    async checkAvailableBalanceForLend(
        accountId: string,
        assetId: string,
        quantityBaseUnits: string
    ): Promise<void> {
        const portfolioBalanceRaw = await this.getAssetBalance(accountId, assetId);
        const portfolioBalance = BigInt(portfolioBalanceRaw);

        const totalOpenOrders = await this.orderRepository.getTotalOpenQuantity(
            accountId,
            assetId,
            OrderSide.Lend,
        );

        const availableBalance = portfolioBalance - totalOpenOrders;

        if (BigInt(quantityBaseUnits) > availableBalance) {
            throw new BadRequestException("Insufficient portfolio balance for this order");
        }
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
        const [tokens, riskParams] = await Promise.all([
            this.portfolioRepository.getTokensByAssetIds(assetIds),
            this.portfolioRepository.getRiskParamsByCollateralTokenIds(assetIds),
        ]);

        const tokenMap = new Map(tokens.map((t) => [t.id, t]));
        const riskMap = new Map(riskParams.map((r) => [r.asset_id, r]));
        const allPrices = this.priceService.getPrices();

        const data = userAssets.map((ua) => {
            const token = tokenMap.get(ua.asset_id);
            const risk = riskMap.get(ua.asset_id);
            const price = allPrices[ua.asset_id.toLowerCase()];
            const decimals = token?.decimals ?? 0;
            const amountHuman = Number(baseUnitsToHuman(ua.amount, decimals));
            // risk table stores basis points (e.g. 7500 = 75%)
            const ltv = risk ? Number(risk.avg_ltv) / 10000 : 0;
            const liquidationThreshold = risk ? Number(risk.avg_lt) / 10000 : 0;
            return {
                symbol: token?.symbol || "UNKNOWN",
                name: token?.name || "Unknown Token",
                walletBalance: amountHuman,
                amountInUsd: calculateUsdAmount(amountHuman, price ?? 0),
                isCollateral: !!ua.is_collateral,
                imageUrl: token?.imageUrl ?? null,
                ltv,
                liquidationThreshold,
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
            const decimals = Number(position.decimals) || 0;
            const quantityHuman = Number(baseUnitsToHuman(position.quantity, decimals));

            return {
                id: position.position_id,
                symbol: position.symbol,
                name: position.name,
                walletBalance: quantityHuman,
                amountInUsd: calculateUsdAmount(quantityHuman, price ?? 0),
                isCollateral: false,
                imageUrl: position.image_url ?? null,
                side: position.side as 'LEND' | 'BORROW',
                maturity: position.maturity ? new Date(position.maturity).getTime() / 1000 : null,
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

    async getAssetBalance(accountId: string, assetId: string): Promise<string> {
        const balances = await this.portfolioRepository.getUserTotalBalances(accountId);
        const match = balances.find(b => b.asset_id === assetId);
        return match ? match.total_amount : "0";
    }
}
