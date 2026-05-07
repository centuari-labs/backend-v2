import {
    BadRequestException,
    Injectable,
    InternalServerErrorException,
    Logger,
    NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import type { TransactionReceipt } from "viem";
import { Token } from "../tokens/entities/token.entity";
import { PriceService } from "../price/price.service";
import { TokensService } from "../tokens/tokens.service";
import { ViemService } from "../core/viem/viem.service";
import { ChainConfigService } from "../core/chain-config/chain-config.service";
import { DatabaseService } from "../core/database/database.service";
import { applyWithdrawLendEffects } from "../core/on-chain-state/apply-withdraw-lend";
import { centuariAbi } from "../../abis/centuari";
import {
    WithdrawLendPositionDto,
    WithdrawLendPositionResponseDto,
} from "./dto/withdraw-lend-position.dto";
import type { OrderHistoryItem } from "./dto/order-history.dto";
import { OrderHistoryQueryDto } from "./dto/order-history.dto";
import type { TransactionHistoryItem } from "./dto/transaction-history.dto";
import { TransactionHistoryQueryDto } from "./dto/transaction-history.dto";
import type { OpenOrderItem } from "./dto/open-orders.dto";
import { OpenOrdersQueryDto } from "./dto/open-orders.dto";
import {
    MyPortfolioResponseDto,
    GetMyAssetsQueryDto,
    MyAssetsResponseDto,
    LendBorrowAssetResponseDto,
    GetMyPositionResponseDto,
    MyPositionQueryDto,
    MyHealthFactorResponseDto,
    UserDetailsResponseDto,
} from "./dto/portfolio.dto";
import { PortfolioRepository } from "./repositories/portfolio.repository";
import { OrderRepository } from "../orders/repositories/order.repository";
import { MarketRepositories } from "../market/repository/market.repository";
import { bytes32ToUuid, uuidToBytes32 } from "../common/utils/uuid.utils";
import { parseContractError } from "../common/utils/contract-errors.utils";
import {
    calculateUsdAmount,
    createPaginatedResponse,
} from "./helpers/position.helpers";
import {
    baseUnitsToHuman,
    safeBigInt,
    toPercentage,
} from "../common/utils/number.utils";
import {
    computeHealthFactor,
    formatHealthFactorResponse,
    MIN_HEALTH_FACTOR,
    type CollateralPositionInput,
    type DebtPositionInput,
    type HealthFactorResult,
    type HealthFactorOptions,
} from "./helpers/health-factor.helpers";
import { OrderSide, OrderStatus } from "../orders/constants/order.constants";

@Injectable()
export class PortfolioService {
    private readonly logger = new Logger(PortfolioService.name);

    constructor(
        @InjectRepository(Token)
        private readonly tokenRepository: Repository<Token>,
        private readonly priceService: PriceService,
        private readonly tokensService: TokensService,
        private readonly portfolioRepository: PortfolioRepository,
        private readonly orderRepository: OrderRepository,
        private readonly marketRepository: MarketRepositories,
        private readonly viemService: ViemService,
        private readonly chainConfig: ChainConfigService,
        private readonly databaseService: DatabaseService,
    ) {}

    async getMyPortfolio(wallet: string): Promise<MyPortfolioResponseDto> {
        const [balances, suppliedAssets, borrowedAssets, lendForApr] =
            await Promise.all([
                this.portfolioRepository.getUserBalances(wallet),
                this.portfolioRepository.getUserSuppliedAssets(wallet),
                this.portfolioRepository.getUserBorrowedAssets(wallet),
                this.portfolioRepository.getUserLendPositionsForApr(wallet),
            ]);

        const allPrices = this.priceService.getPrices();

        const totalBalanceUsd = sumUsd(balances, allPrices);
        const suppliedAssetsUsd = sumUsd(suppliedAssets, allPrices);
        const borrowedAssetsUsd = sumUsd(borrowedAssets, allPrices);

        // Weighted APR: `rate` is indexer-v3's RATE_PRECISION=10000 bps,
        // weighted by the principal on each lend_position row.
        let weightedRate = 0;
        let weightSum = 0;
        for (const row of lendForApr) {
            const principalHuman = Number(
                baseUnitsToHuman(row.amount, row.decimals),
            );
            if (principalHuman <= 0) continue;
            const apr = Number(row.apr) / 10000;
            weightedRate += apr * principalHuman;
            weightSum += principalHuman;
        }
        const netAPR = weightSum > 0 ? weightedRate / weightSum : 0;

        const availableBalanceUsd = Math.max(
            0,
            totalBalanceUsd - suppliedAssetsUsd,
        );
        const total =
            availableBalanceUsd + suppliedAssetsUsd + borrowedAssetsUsd;
        const pct = (v: number): number => (total > 0 ? (v / total) * 100 : 0);

        // allTimeReturn needs original-principal history, which the shared
        // current-state schema does not retain. Returning 0 in A5; Phase B
        // can reconstruct from match history or on-chain events.
        return {
            totalDeposit: Number(totalBalanceUsd.toFixed(2)),
            allTimeReturn: 0,
            netAPY: Number((netAPR * 100).toFixed(2)),
            allocation: {
                availableBalanceUsd: Number(availableBalanceUsd.toFixed(2)),
                suppliedAssetsUsd: Number(suppliedAssetsUsd.toFixed(2)),
                borrowedAssetsUsd: Number(borrowedAssetsUsd.toFixed(2)),
                availableBalancePct: Number(
                    pct(availableBalanceUsd).toFixed(2),
                ),
                suppliedAssetsPct: Number(pct(suppliedAssetsUsd).toFixed(2)),
                borrowedAssetsPct: Number(pct(borrowedAssetsUsd).toFixed(2)),
            },
        };
    }

    async getLendBorrowAssets(
        wallet: string,
        days = 90,
    ): Promise<
        LendBorrowAssetResponseDto & {
            chartData: {
                date: string;
                lendAmount: string;
                borrowAmount: string;
            }[];
        }
    > {
        const account = await this.orderRepository.findAccountByWallet(wallet);
        if (!account) {
            throw new NotFoundException("Account not found");
        }

        const [result, suppliedAssets, borrowedAssets] = await Promise.all([
            this.getHealthFactorForWallet(wallet),
            this.portfolioRepository.getUserSuppliedAssets(wallet),
            this.portfolioRepository.getUserBorrowedAssets(wallet),
        ]);
        const formatted = formatHealthFactorResponse(result);
        const allPrices = this.priceService.getPrices();

        const suppliedAssetsUsd = sumUsd(suppliedAssets, allPrices);
        const borrowedAssetsUsd = sumUsd(borrowedAssets, allPrices);

        const chartRows = await this.portfolioRepository.getUserDailyLendBorrow(
            account.id,
            days,
        );

        // Aggregate per-token rows into per-day USD values
        const dailyUsdMap = new Map<
            string,
            { lendUsd: number; borrowUsd: number }
        >();

        for (const row of chartRows) {
            const dateKey = new Date(row.date).toISOString().split("T")[0];
            const decimals = row.decimals ?? 18;

            const lendHuman = Number(
                baseUnitsToHuman(String(row.lend_amount), decimals),
            );
            const borrowHuman = Number(
                baseUnitsToHuman(String(row.borrow_amount), decimals),
            );

            const price = allPrices[row.asset_id.toLowerCase()] ?? 0;

            const entry = dailyUsdMap.get(dateKey) ?? {
                lendUsd: 0,
                borrowUsd: 0,
            };
            entry.lendUsd += lendHuman * price;
            entry.borrowUsd += borrowHuman * price;
            dailyUsdMap.set(dateKey, entry);
        }

        // Fill all days in the range with cumulative totals
        const chartData: {
            date: string;
            lendAmount: string;
            borrowAmount: string;
        }[] = [];
        let cumulativeLend = 0;
        let cumulativeBorrow = 0;
        const today = new Date();
        for (let i = days; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            const dateKey = d.toISOString().split("T")[0];
            const entry = dailyUsdMap.get(dateKey);
            if (entry) {
                cumulativeLend += entry.lendUsd;
                cumulativeBorrow += entry.borrowUsd;
            }
            chartData.push({
                date: dateKey,
                lendAmount: String(Number(cumulativeLend.toFixed(2))),
                borrowAmount: String(Number(cumulativeBorrow.toFixed(2))),
            });
        }

        // Override the last chart point to match current position USD values
        // (cumulative matches may differ from current shares/debt due to accrued interest)
        if (chartData.length > 0) {
            chartData[chartData.length - 1].lendAmount = String(
                Number(suppliedAssetsUsd.toFixed(3)),
            );
            chartData[chartData.length - 1].borrowAmount = String(
                Number(borrowedAssetsUsd.toFixed(3)),
            );
        }

        return {
            suppliedAssets: Number(suppliedAssetsUsd.toFixed(2)),
            borrowedAssets: Number(borrowedAssetsUsd.toFixed(2)),
            healthFactor: Number.isFinite(formatted.healthFactor)
                ? formatted.healthFactor
                : 0,
            chartData,
        };
    }

    /**
     * Returns health factor for the given account. Accepts an `accountId`
     * (UUID) for backward compatibility with orders.service / orders.worker
     * callers that still carry UUIDs; internally resolves the wallet and
     * reads collateral/debt from the shared on-chain-state schema.
     */
    async getHealthFactorForAccount(
        accountId: string,
        options?: HealthFactorOptions,
    ): Promise<HealthFactorResult> {
        const wallet = await this.resolveWallet(accountId);
        return this.getHealthFactorForWallet(wallet, accountId, options);
    }

    async getHealthFactorForWallet(
        wallet: string,
        accountId?: string,
        options?: HealthFactorOptions,
    ): Promise<HealthFactorResult> {
        const { collateralPositions, debtPositions, additionalDebtPositions } =
            await this.buildHealthFactorInputs(wallet, accountId, options);
        return computeHealthFactor(
            collateralPositions,
            debtPositions,
            additionalDebtPositions,
            options?.additionalBorrowUsd,
        );
    }

    async simulateHealthFactorAfterWithdrawal(
        accountId: string,
        assetId: string,
        collateralReductionBaseUnits: string,
    ): Promise<HealthFactorResult> {
        const wallet = await this.resolveWallet(accountId);
        const { collateralPositions, debtPositions } =
            await this.buildHealthFactorInputs(wallet, accountId);

        const adjusted = collateralPositions.map((pos) => {
            if (pos.assetId !== assetId) return pos;
            const reduced =
                safeBigInt(pos.amountBaseUnits) -
                BigInt(collateralReductionBaseUnits);
            return {
                ...pos,
                amountBaseUnits: (reduced > 0n ? reduced : 0n).toString(),
            };
        });

        return computeHealthFactor(adjusted, debtPositions);
    }

    async getMyHealthFactor(
        wallet: string,
    ): Promise<MyHealthFactorResponseDto> {
        const result = await this.getHealthFactorForWallet(wallet);
        return formatHealthFactorResponse(result);
    }

    /**
     * Builds the inputs for `computeHealthFactor`: collateral from
     * `user_balance` rows flagged `used_as_collateral`; debt from
     * `borrow_position` rolled up per `market.loan_token`. Accepts an
     * `accountId` only to honour the legacy `options.includeOpenOrders`
     * path (matching-engine state, Phase B).
     */
    private async buildHealthFactorInputs(
        wallet: string,
        accountId?: string,
        options?: HealthFactorOptions,
    ): Promise<{
        collateralPositions: CollateralPositionInput[];
        debtPositions: DebtPositionInput[];
        additionalDebtPositions?: DebtPositionInput[];
    }> {
        const [collateralRows, debtRows] = await Promise.all([
            this.portfolioRepository.getUserCollateralAssets(wallet),
            this.portfolioRepository.getUserBorrowedAssets(wallet),
        ]);

        const allPrices = this.priceService.getPrices();
        const riskParams =
            collateralRows.length > 0
                ? await this.portfolioRepository.getRiskParamsByCollateralTokenIds(
                      collateralRows.map((r) => r.asset_id),
                  )
                : [];
        const riskLtvMap = new Map(
            riskParams.map((r) => [r.asset_id, Number(r.avg_ltv)]),
        );
        const tokenLtvFallback = await this.loadTokenLtvFallback(
            collateralRows.map((r) => r.asset_id),
        );

        const collateralPositions: CollateralPositionInput[] =
            collateralRows.map((row) => ({
                assetId: row.asset_id,
                amountBaseUnits: row.amount,
                decimals: row.decimals,
                priceUsd: allPrices[row.asset_id.toLowerCase()] ?? 0,
                ltvBps:
                    riskLtvMap.get(row.asset_id) ??
                    tokenLtvFallback.get(row.asset_id) ??
                    0,
            }));

        const debtPositions: DebtPositionInput[] = debtRows.map((row) => ({
            assetId: row.asset_id,
            amountBaseUnits: row.amount,
            decimals: row.decimals,
            priceUsd: allPrices[row.asset_id.toLowerCase()] ?? 0,
        }));

        const additionalDebtPositions: DebtPositionInput[] = [];
        if (options?.additionalDebt) {
            const decimals =
                (await this.tokensService.getTokenDecimalsByAssetId(
                    options.additionalDebt.assetId,
                )) ?? 0;
            additionalDebtPositions.push({
                assetId: options.additionalDebt.assetId,
                amountBaseUnits: options.additionalDebt.amountBaseUnits,
                decimals,
                priceUsd:
                    allPrices[options.additionalDebt.assetId.toLowerCase()] ??
                    0,
            });
        }

        if (options?.includeOpenOrders && accountId) {
            const openOrders =
                await this.orderRepository.getOpenBorrowOrders(accountId);
            for (const order of openOrders) {
                const decimals =
                    (await this.tokensService.getTokenDecimalsByAssetId(
                        order.assetId,
                    )) ?? 0;
                additionalDebtPositions.push({
                    assetId: order.assetId,
                    amountBaseUnits: (
                        BigInt(order.quantity) - BigInt(order.filledQuantity)
                    ).toString(),
                    decimals,
                    priceUsd: allPrices[order.assetId.toLowerCase()] ?? 0,
                });
            }
        }

        return {
            collateralPositions,
            debtPositions,
            additionalDebtPositions:
                additionalDebtPositions.length > 0
                    ? additionalDebtPositions
                    : undefined,
        };
    }

    /**
     * Token-entity LTV fallback for collateral assets whose `risk` row is
     * missing. Keeps the legacy behaviour where `token.averageLTV` seeded
     * loan tokens could still contribute.
     */
    private async loadTokenLtvFallback(
        assetIds: string[],
    ): Promise<Map<string, number>> {
        if (assetIds.length === 0) return new Map();
        const tokens = await this.tokenRepository.find({
            select: ["id", "averageLTV"],
        });
        const out = new Map<string, number>();
        for (const t of tokens) {
            if (!assetIds.includes(t.id)) continue;
            if (t.averageLTV != null) out.set(t.id, Number(t.averageLTV));
        }
        return out;
    }

    /**
     * Resolves a backend `account.id` UUID to the wallet address stored on
     * that account. Throws when the account is unknown — callers that pass
     * an accountId are required to have created it earlier in the request
     * flow (matching-engine order submission path).
     */
    private async resolveWallet(accountId: string): Promise<`0x${string}`> {
        const wallet =
            await this.orderRepository.findWalletByAccountId(accountId);
        if (!wallet) {
            throw new NotFoundException(
                `Account ${accountId} has no wallet address`,
            );
        }
        return wallet.toLowerCase() as `0x${string}`;
    }

    async calculateOpenBorrowOrdersUsd(accountId: string): Promise<number> {
        const openOrders =
            await this.orderRepository.getOpenBorrowOrders(accountId);
        let totalUsd = 0;
        const allPrices = this.priceService.getPrices();

        for (const order of openOrders) {
            const price = allPrices[order.assetId.toLowerCase()];
            const decimals = await this.tokensService.getTokenDecimalsByAssetId(
                order.assetId,
            );
            if (price != null && decimals != null) {
                const remainingAmountHuman = Number(
                    baseUnitsToHuman(
                        (
                            BigInt(order.quantity) -
                            BigInt(order.filledQuantity)
                        ).toString(),
                        decimals,
                    ),
                );
                totalUsd += remainingAmountHuman * price;
            }
        }

        return totalUsd;
    }

    async checkAvailableBalanceForLend(
        accountId: string,
        assetId: string,
        quantityBaseUnits: string,
        settlementFeeBaseUnits = "0",
        estimatedTradeFeeBaseUnits = "0",
    ): Promise<void> {
        const portfolioBalanceRaw = await this.getAssetBalance(
            accountId,
            assetId,
        );
        const portfolioBalance = safeBigInt(portfolioBalanceRaw);

        const lockedAmount = await this.getLockedAmount(accountId, assetId);

        const totalOpenOrders = await this.orderRepository.getTotalOpenQuantity(
            accountId,
            assetId,
            OrderSide.Lend,
        );

        const availableBalance =
            portfolioBalance - lockedAmount - totalOpenOrders;

        const totalRequired =
            BigInt(quantityBaseUnits) +
            BigInt(settlementFeeBaseUnits) +
            BigInt(estimatedTradeFeeBaseUnits);

        if (totalRequired > availableBalance) {
            throw new BadRequestException(
                "Insufficient portfolio balance for this order (amount + fees exceed available balance)",
            );
        }
    }

    async checkAvailableBalanceForBorrowFees(
        accountId: string,
        assetId: string,
        settlementFeeBaseUnits = "0",
        estimatedTradeFeeBaseUnits = "0",
    ): Promise<void> {
        const totalFees =
            BigInt(settlementFeeBaseUnits) + BigInt(estimatedTradeFeeBaseUnits);

        if (totalFees <= 0n) return;

        const portfolioBalanceRaw = await this.getAssetBalance(
            accountId,
            assetId,
        );
        const portfolioBalance = safeBigInt(portfolioBalanceRaw);

        const lockedAmount = await this.getLockedAmount(accountId, assetId);

        const availableBalance = portfolioBalance - lockedAmount;

        if (totalFees > availableBalance) {
            const token = await this.tokensService.getTokenByAssetId(assetId);
            throw new BadRequestException(
                `Insufficient ${token.symbol} balance to cover borrow fees. Please deposit some ${token.symbol} first to cover settlement and trade fees.`,
            );
        }
    }

    async getMyAssets(
        wallet: string,
        query: GetMyAssetsQueryDto,
    ): Promise<MyAssetsResponseDto> {
        const { page = 1, limit = 10 } = query;

        const { data: rows, total } =
            await this.portfolioRepository.getUserAssets(wallet, page, limit);

        if (rows.length === 0) {
            return createPaginatedResponse([], total, page, limit);
        }

        const allPrices = this.priceService.getPrices();
        const riskParams =
            await this.portfolioRepository.getRiskParamsByCollateralTokenIds(
                rows.map((r) => r.asset_id),
            );
        const riskMap = new Map(riskParams.map((r) => [r.asset_id, r]));

        const data = rows.map((row) => {
            const walletBalance = Number(
                baseUnitsToHuman(row.amount, row.decimals),
            );
            const price = allPrices[row.asset_id.toLowerCase()] ?? 0;
            const risk = riskMap.get(row.asset_id);
            return {
                assetId: row.asset_id,
                symbol: row.symbol || "UNKNOWN",
                name: row.name || "Unknown Token",
                // `lockedInOrders` = 0 in A5; Phase B sources the
                // matching-engine reservation counter from Redis.
                walletBalance,
                amountInUsd: calculateUsdAmount(walletBalance, price),
                isCollateral: row.is_collateral,
                imageUrl: row.image_url,
                ltv: risk ? Number(risk.avg_ltv) / 10000 : 0,
                liquidationThreshold: risk ? Number(risk.avg_lt) / 10000 : 0,
            };
        });

        return createPaginatedResponse(data, total, page, limit);
    }

    async getMyPosition(
        wallet: string,
        query: MyPositionQueryDto,
    ): Promise<GetMyPositionResponseDto> {
        const { page = 1, limit = 10, type, assetId } = query;

        const { data: rows, total } =
            await this.portfolioRepository.getUserPositions(
                wallet,
                type,
                page,
                limit,
                assetId,
            );

        if (rows.length === 0) {
            return createPaginatedResponse([], total, page, limit);
        }

        const allPrices = this.priceService.getPrices();

        const data = rows.map((row) => {
            const decimals = Number(row.decimals) || 0;
            const sharesHuman = Number(
                baseUnitsToHuman(row.quantity, decimals),
            );
            const baseAmountHuman = Number(
                baseUnitsToHuman(row.base_amount ?? "0", decimals),
            );
            const price = allPrices[row.asset_id.toLowerCase()];
            const marketIdUuid = bytes32ToUuid(row.market_id);
            return {
                id: `${marketIdUuid}:${row.side}`,
                marketId: marketIdUuid,
                symbol: row.symbol,
                name: row.name,
                shares: sharesHuman,
                baseAmount: baseAmountHuman,
                amountInUsd: calculateUsdAmount(sharesHuman, price ?? 0),
                isCollateral: false,
                imageUrl: row.image_url ?? null,
                side: row.side as "LEND" | "BORROW",
                maturity: row.maturity
                    ? Math.floor(new Date(row.maturity).getTime() / 1000)
                    : null,
                apr: Number(row.rate) || 0,
            };
        });

        return createPaginatedResponse(data, total, page, limit);
    }

    async getOrderHistory(wallet: string, query: OrderHistoryQueryDto) {
        const account = await this.orderRepository.findAccountByWallet(wallet);
        if (!account) {
            return createPaginatedResponse(
                [],
                0,
                query.page ?? 1,
                query.limit ?? 10,
            );
        }

        const { data: rows, total } =
            await this.portfolioRepository.getOrderHistory(
                account.id,
                query.page ?? 1,
                query.limit ?? 10,
                {
                    assetId: query.assetId,
                    side: query.side,
                    status: query.status,
                    startDate: query.startDate,
                    endDate: query.endDate,
                },
            );

        const items: OrderHistoryItem[] = rows.map((row) => ({
            id: row.id,
            side: row.side,
            orderType: row.order_type,
            rate: toPercentage(Number(row.rate)),
            amount: baseUnitsToHuman(row.amount, Number(row.decimals) || 0),
            filledQuantity: row.filled_quantity
                ? baseUnitsToHuman(
                      row.filled_quantity,
                      Number(row.decimals) || 0,
                  )
                : null,
            status: row.status,
            cancelReason: row.cancel_reason ?? null,
            asset: {
                id: row.asset_id,
                name: row.name,
                symbol: row.symbol,
                decimals: Number(row.decimals) || 0,
                imageUrl: row.image_url,
                tokenAddress: row.token_address,
            },
            maturity: row.maturity
                ? new Date(row.maturity).toISOString()
                : null,
            fee:
                row.total_fee && row.total_fee !== "0"
                    ? baseUnitsToHuman(row.total_fee, Number(row.decimals) || 0)
                    : null,
            createdAt: new Date(row.created_at).toISOString(),
        }));

        return createPaginatedResponse(
            items,
            total,
            query.page ?? 1,
            query.limit ?? 10,
        );
    }

    async getOpenOrders(wallet: string, query: OpenOrdersQueryDto) {
        const account = await this.orderRepository.findAccountByWallet(wallet);
        if (!account) {
            return createPaginatedResponse(
                [],
                0,
                query.page ?? 1,
                query.limit ?? 10,
            );
        }

        const { data: rows, total } =
            await this.portfolioRepository.getOpenOrders(
                account.id,
                query.page ?? 1,
                query.limit ?? 10,
                {
                    side: query.side,
                    status: query.status,
                    startDate: query.startDate,
                    endDate: query.endDate,
                    assetId: query.assetId,
                },
            );

        const items: OpenOrderItem[] = rows.map((row) => ({
            id: row.id,
            side: row.side,
            orderType: row.order_type,
            rate: toPercentage(Number(row.rate)),
            amount: baseUnitsToHuman(row.amount, Number(row.decimals) || 0),
            filledQuantity: row.filled_quantity
                ? baseUnitsToHuman(
                      row.filled_quantity,
                      Number(row.decimals) || 0,
                  )
                : null,
            status: row.status,
            cancelReason: row.cancel_reason ?? null,
            maturity: row.maturity
                ? new Date(row.maturity).toISOString()
                : null,
            asset: {
                id: row.asset_id,
                name: row.name,
                symbol: row.symbol,
                decimals: Number(row.decimals) || 0,
                imageUrl: row.image_url,
                tokenAddress: row.token_address,
            },
            createdAt: new Date(row.created_at).toISOString(),
        }));

        return createPaginatedResponse(
            items,
            total,
            query.page ?? 1,
            query.limit ?? 10,
        );
    }

    async getAssetBalance(accountId: string, assetId: string): Promise<string> {
        const balances =
            await this.portfolioRepository.getUserTotalBalances(accountId);
        const match = balances.find((b) => b.asset_id === assetId);
        return match ? match.total_amount : "0";
    }

    async getLockedAmount(accountId: string, assetId: string): Promise<bigint> {
        const result = await this.portfolioRepository.findOne({
            where: { accountId, assetId },
            select: ["lockedAmount"],
        });
        return safeBigInt(result?.lockedAmount ?? "0");
    }

    async withdrawLendPosition(
        dto: WithdrawLendPositionDto,
        walletAddress: string,
        _privyUserId: string,
    ): Promise<WithdrawLendPositionResponseDto> {
        const { marketId } = dto;

        const market = await this.marketRepository.getMarketWithAsset(marketId);
        if (!market) {
            throw new NotFoundException("Market not found");
        }

        const maturityDate = market.maturity ? new Date(market.maturity) : null;
        if (!maturityDate) {
            throw new BadRequestException("Market has no maturity date");
        }

        const maturityUnix = Math.floor(maturityDate.getTime() / 1000);
        const nowUnix = Math.floor(Date.now() / 1000);
        if (nowUnix < maturityUnix) {
            throw new BadRequestException("Position has not matured yet");
        }

        // Convert backend UUID → bytes32 for on-chain call + shared-schema
        // lookup (matching-engine / settlement-engine use the same encoding,
        // so indexer-v3's `market_id` stores this bytes32 as well).
        const marketIdBytes32 = uuidToBytes32(marketId);

        const position = await this.portfolioRepository.getLendPosition(
            marketIdBytes32,
            walletAddress,
        );
        if (!position || BigInt(position.cbt_balance) <= 0n) {
            throw new NotFoundException("No active lend positions found");
        }
        const totalShares = BigInt(position.cbt_balance);

        this.logger.log(
            `Executing withdrawLendPosition: marketId=${marketId}, marketIdBytes32=${marketIdBytes32}, token=${market.tokenAddress}, maturity=${maturityUnix}, cbtAmount=${totalShares}`,
        );

        const receipt = await this.executeBlockchainWithdraw(
            marketIdBytes32,
            market.tokenAddress,
            BigInt(maturityUnix),
            totalShares,
        );

        try {
            await applyWithdrawLendEffects({
                pool: this.databaseService.getPool(),
                client: this.viemService.getPublicClient(
                    this.chainConfig.chainId,
                ),
                receipt,
                expectedLender: walletAddress as `0x${string}`,
            });
            this.logger.log(
                `Withdraw lend position applied to shared schema for tx ${receipt.transactionHash}`,
            );
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            this.logger.error(
                `CRITICAL: withdrawLendPosition on-chain success (${receipt.transactionHash}) but applyOnChainEffect failed: ${msg}`,
            );
            throw new InternalServerErrorException(
                "Withdraw finalized on-chain but failed local state update.",
            );
        }

        return {
            txHash: receipt.transactionHash,
            status: "success",
        };
    }

    private async executeBlockchainWithdraw(
        marketId: `0x${string}`,
        loanToken: string,
        maturity: bigint,
        cbtAmount: bigint,
    ): Promise<TransactionReceipt> {
        try {
            const receipt = (await this.viemService.writeContract(
                this.chainConfig.chainId,
                this.chainConfig.operatorPrivateKey,
                this.chainConfig.centuariAddress,
                centuariAbi,
                "withdrawLendPosition",
                [marketId, loanToken, maturity, cbtAmount],
                { waitForReceipt: true },
            )) as TransactionReceipt;
            return receipt;
        } catch (error: any) {
            this.logger.error(`Contract call failed: ${error.message}`);
            const parsed = parseContractError(error.message);
            if (parsed.isKnown) {
                throw new BadRequestException(parsed.message);
            }
            throw new InternalServerErrorException(parsed.message);
        }
    }

    async getUserDetails(wallet: string): Promise<UserDetailsResponseDto> {
        const account = await this.orderRepository.findAccountByWallet(wallet);

        const [balanceRows, debtRows, openBorrowOrders] = await Promise.all([
            this.portfolioRepository.getUserBalances(wallet),
            this.portfolioRepository.getUserBorrowedAssets(wallet),
            account
                ? this.orderRepository.getOpenBorrowOrders(account.id)
                : Promise.resolve([]),
        ]);

        const hfResult = await this.getHealthFactorForWallet(
            wallet,
            account?.id,
        );

        const allPrices = this.priceService.getPrices();
        const riskParams =
            balanceRows.length > 0
                ? await this.portfolioRepository.getRiskParamsByCollateralTokenIds(
                      balanceRows.map((r) => r.asset_id),
                  )
                : [];
        const riskMap = new Map(riskParams.map((r) => [r.asset_id, r]));

        const assets = balanceRows.map((row) => {
            const price = allPrices[row.asset_id.toLowerCase()] ?? 0;
            const availableHuman = Number(
                baseUnitsToHuman(row.amount, row.decimals),
            );
            const risk = riskMap.get(row.asset_id);
            // `lockedInOrders` = 0 in A5 (Phase B sources matching-engine
            // reservations). `totalBalance === availableBalance` here.
            return {
                assetId: row.asset_id,
                symbol: row.symbol || "UNKNOWN",
                name: row.name || "Unknown Token",
                imageUrl: row.image_url,
                totalBalance: availableHuman,
                lockedInOrders: 0,
                availableBalance: availableHuman,
                availableBalanceUsd: Number(
                    (availableHuman * price).toFixed(2),
                ),
                isCollateral: row.is_collateral,
                ltv: risk ? Number(risk.avg_ltv) / 10000 : 0,
                liquidationThreshold: risk ? Number(risk.avg_lt) / 10000 : 0,
            };
        });

        // Settled debt — aggregated per loan-token by the repository.
        let settledDebtUsd = 0;
        const debts: {
            assetId: string;
            debtAmount: number;
            debtAmountUsd: number;
        }[] = [];
        for (const row of debtRows) {
            const price = allPrices[row.asset_id.toLowerCase()] ?? 0;
            const debtHuman = Number(
                baseUnitsToHuman(row.amount, row.decimals),
            );
            const debtUsd = debtHuman * price;
            settledDebtUsd += debtUsd;
            debts.push({
                assetId: row.asset_id,
                debtAmount: debtHuman,
                debtAmountUsd: Number(debtUsd.toFixed(2)),
            });
        }

        // Pending debt from open borrow orders — matching-engine state,
        // still on the legacy schema until Phase B.
        let pendingDebtUsd = 0;
        for (const order of openBorrowOrders) {
            const decimals =
                (await this.tokensService.getTokenDecimalsByAssetId(
                    order.assetId,
                )) ?? 0;
            const price = allPrices[order.assetId.toLowerCase()] ?? 0;
            const remainingBaseUnits = (
                BigInt(order.quantity) - BigInt(order.filledQuantity)
            ).toString();
            pendingDebtUsd +=
                Number(baseUnitsToHuman(remainingBaseUnits, decimals)) * price;
        }

        const formattedHf = formatHealthFactorResponse(hfResult);

        return {
            assets,
            totalDebtUsd: Number((settledDebtUsd + pendingDebtUsd).toFixed(2)),
            settledDebtUsd: Number(settledDebtUsd.toFixed(2)),
            pendingDebtUsd: Number(pendingDebtUsd.toFixed(2)),
            debts,
            healthFactor: formattedHf.healthFactor,
            collateralUsd: formattedHf.collateralUsd,
            weightedLtv: formattedHf.weightedLtv,
        };
    }

    async getTransactionHistory(
        wallet: string,
        query: TransactionHistoryQueryDto,
    ) {
        const account = await this.orderRepository.findAccountByWallet(wallet);
        if (!account) {
            return createPaginatedResponse(
                [],
                0,
                query.page ?? 1,
                query.limit ?? 10,
            );
        }

        const { data: rows, total } =
            await this.portfolioRepository.getTransactionHistory(
                account.id,
                query.page ?? 1,
                query.limit ?? 10,
                {
                    assetId: query.assetId,
                    side: query.side,
                    startDate: query.startDate,
                    endDate: query.endDate,
                },
            );

        const items: TransactionHistoryItem[] = rows.map((row) => {
            const isLender = row.lender_account_id === account.id;
            const decimals = Number(row.decimals) || 0;

            const totalFee = isLender
                ? (
                      BigInt(row.maker_fee || "0") +
                      BigInt(row.taker_fee || "0") +
                      BigInt(row.lender_settlement_fee || "0")
                  ).toString()
                : (
                      BigInt(row.maker_fee || "0") +
                      BigInt(row.taker_fee || "0") +
                      BigInt(row.borrower_settlement_fee || "0")
                  ).toString();

            return {
                id: row.id,
                side: isLender ? "LEND" : "BORROW",
                rate: toPercentage(Number(row.rate)) || 0,
                amount: baseUnitsToHuman(row.match_amount, decimals),
                fee:
                    totalFee !== "0"
                        ? baseUnitsToHuman(totalFee, decimals)
                        : null,
                asset: {
                    id: row.asset_id,
                    name: row.name,
                    symbol: row.symbol,
                    decimals,
                    imageUrl: row.image_url,
                    tokenAddress: row.token_address,
                },
                maturity: new Date(row.maturity).toISOString(),
                createdAt: new Date(row.created_at).toISOString(),
            };
        });

        return createPaginatedResponse(
            items,
            total,
            query.page ?? 1,
            query.limit ?? 10,
        );
    }
}

/**
 * Sum USD across row sets shaped `{ asset_id, amount, decimals }`. Prices
 * are looked up by backend `tokens.id` UUID (already lowercased by
 * `PriceService.getPrices`). Rows with no price are skipped silently —
 * aggregate totals degrade gracefully rather than throw.
 */
function sumUsd(
    rows: Array<{ asset_id: string; amount: string; decimals: number }>,
    prices: Record<string, number>,
): number {
    let total = 0;
    for (const row of rows) {
        const price = prices[row.asset_id.toLowerCase()];
        if (price === undefined) continue;
        const amountHuman = Number(baseUnitsToHuman(row.amount, row.decimals));
        total += amountHuman * price;
    }
    return total;
}
