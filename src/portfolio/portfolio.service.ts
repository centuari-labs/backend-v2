import {
    BadRequestException,
    Injectable,
    InternalServerErrorException,
    Logger,
    NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { ConfigService } from "@nestjs/config";
import type { TransactionReceipt } from "viem";
import { Token } from "../tokens/entities/token.entity";
import { PriceService } from "../price/price.service";
import { TokensService } from "../tokens/tokens.service";
import { ViemService } from "../core/viem/viem.service";
import { centuariAbi } from "../../abis/centuari";
import {
    WithdrawLendPositionDto,
    WithdrawLendPositionResponseDto,
} from "./dto/withdraw-lend-position.dto";
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
    SetAssetAsCollateralDto,
    MyHealthFactorResponseDto,
    UserDetailsResponseDto,
} from "./dto/portfolio.dto";
import { PortfolioRepository } from "./repositories/portfolio.repository";
import { OrderRepository } from "../orders/repositories/order.repository";
import { MarketRepositories } from "../market/repository/market.repository";
import { portfolioUuidFor } from "../common/utils/uuid.utils";
import {
    calculateUsdAmount,
    createPaginatedResponse,
} from "./helpers/position.helpers";
import { baseUnitsToHuman } from "../common/utils/number.utils";
import { getFirstEventFromReceipt } from "../common/utils/event.utils";
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
    private readonly logger = new Logger(PortfolioService.name);
    private readonly chainId: number;
    private readonly operatorPrivateKey: string;
    private readonly centuariAddress: string;

    constructor(
        @InjectRepository(Token)
        private readonly tokenRepository: Repository<Token>,
        private readonly priceService: PriceService,
        private readonly tokensService: TokensService,
        private readonly portfolioRepository: PortfolioRepository,
        private readonly orderRepository: OrderRepository,
        private readonly marketRepository: MarketRepositories,
        private readonly viemService: ViemService,
        private readonly configService: ConfigService,
        private readonly dataSource: DataSource,
    ) {
        this.chainId = Number(
            this.configService.get<string>("DEPOSIT_CHAIN_ID") ?? "421614",
        );
        this.operatorPrivateKey =
            this.configService.get<string>("OPERATOR_PRIVATE_KEY") ?? "";
        this.centuariAddress =
            this.configService.get<string>("CENTUARI_ADDRESS") ?? "";
    }

    async getMyPortfolio(wallet: string): Promise<MyPortfolioResponseDto> {
        const account = await this.orderRepository.findAccountByWallet(wallet);
        if (!account) {
            throw new NotFoundException("Account not found");
        }

        const allPrices = this.priceService.getPrices();

        let totalBalanceUsd = 0;

        const [portfolio, lendPositions, suppliedAssets, borrowedAssets] =
            await Promise.all([
                this.portfolioRepository.getUserTotalBalances(account.id),
                this.portfolioRepository.getUserLendPositionsForApr(account.id),
                this.portfolioRepository.getUserSuppliedAssets(account.id),
                this.portfolioRepository.getUserBorrowedAssets(account.id),
            ]);

        for (const deposit of portfolio) {
            const decimals = await this.tokensService.getTokenDecimalsByAssetId(
                deposit.asset_id,
            );
            if (decimals == null) continue;
            const amountHuman = Number(
                baseUnitsToHuman(deposit.total_amount, decimals),
            );
            const price = allPrices[deposit.asset_id.toLowerCase()];
            if (price !== undefined) {
                totalBalanceUsd += amountHuman * price;
            }
        }

        let netAPR = 0;
        let allTimeReturnUsd = 0;
        if (lendPositions.length > 0) {
            let totalWeightedAPR = 0;
            let totalAmount = 0;

            for (const position of lendPositions) {
                const decimals =
                    await this.tokensService.getTokenDecimalsByAssetId(
                        position.asset_id,
                    );
                if (decimals == null) continue;

                const amountHuman = Number(
                    baseUnitsToHuman(position.amount, decimals),
                );
                const sharesHuman = Number(
                    baseUnitsToHuman(position.shares, decimals),
                );

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
            const decimals = await this.tokensService.getTokenDecimalsByAssetId(
                position.asset_id,
            );
            if (decimals == null) continue;
            const amountHuman = Number(
                baseUnitsToHuman(position.amount, decimals),
            );
            if (amountHuman <= 0) continue;

            const price = allPrices[position.asset_id.toLowerCase()];
            if (price === undefined) continue;

            suppliedAssetsUsd += amountHuman * price;
        }

        let borrowedAssetsUsd = 0;
        for (const position of borrowedAssets) {
            const decimals = await this.tokensService.getTokenDecimalsByAssetId(
                position.asset_id,
            );
            if (decimals == null) continue;
            const amountHuman = Number(
                baseUnitsToHuman(position.amount, decimals),
            );
            if (amountHuman <= 0) continue;

            const price = allPrices[position.asset_id.toLowerCase()];
            if (price === undefined) continue;

            borrowedAssetsUsd += amountHuman * price;
        }

        const availableBalanceUsdRaw = totalBalanceUsd - suppliedAssetsUsd;
        const availableBalanceUsd =
            availableBalanceUsdRaw > 0 ? availableBalanceUsdRaw : 0;

        const allocationTotalUsd =
            availableBalanceUsd + suppliedAssetsUsd + borrowedAssetsUsd;

        let availableBalancePct = 0;
        let suppliedAssetsPct = 0;
        let borrowedAssetsPct = 0;

        if (allocationTotalUsd > 0) {
            availableBalancePct =
                (availableBalanceUsd / allocationTotalUsd) * 100;
            suppliedAssetsPct = (suppliedAssetsUsd / allocationTotalUsd) * 100;
            borrowedAssetsPct = (borrowedAssetsUsd / allocationTotalUsd) * 100;
        }

        return {
            totalDeposit: Number(totalBalanceUsd.toFixed(2)),
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
            this.getHealthFactorForAccount(account.id),
            this.portfolioRepository.getUserSuppliedAssets(account.id),
            this.portfolioRepository.getUserBorrowedAssets(account.id),
        ]);
        const formatted = formatHealthFactorResponse(result);
        const allPrices = this.priceService.getPrices();

        let suppliedAssetsUsd = 0;
        for (const position of suppliedAssets) {
            const decimals = await this.tokensService.getTokenDecimalsByAssetId(
                position.asset_id,
            );
            if (decimals == null) continue;
            const amountHuman = Number(
                baseUnitsToHuman(position.amount, decimals),
            );
            if (amountHuman <= 0) continue;
            const price = allPrices[position.asset_id.toLowerCase()];
            if (price === undefined) continue;
            suppliedAssetsUsd += amountHuman * price;
        }

        let borrowedAssetsUsd = 0;
        for (const position of borrowedAssets) {
            const decimals = await this.tokensService.getTokenDecimalsByAssetId(
                position.asset_id,
            );
            if (decimals == null) continue;
            const amountHuman = Number(
                baseUnitsToHuman(position.amount, decimals),
            );
            if (amountHuman <= 0) continue;
            const price = allPrices[position.asset_id.toLowerCase()];
            if (price === undefined) continue;
            borrowedAssetsUsd += amountHuman * price;
        }

        const chartRows = await this.portfolioRepository.getUserDailyLendBorrow(
            account.id,
            days,
        );

        const chartData = chartRows.map((row) => ({
            date: new Date(row.date).toISOString().split("T")[0],
            lendAmount: String(row.lend_amount),
            borrowAmount: String(row.borrow_amount),
        }));

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

    async getMyHealthFactor(
        wallet: string,
    ): Promise<MyHealthFactorResponseDto> {
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
        const [collateralRows, debtRows, tokens, allPrices] = await Promise.all(
            [
                this.portfolioRepository.getUserCollateralAssets(accountId),
                this.portfolioRepository.getUserBorrowedAssets(accountId),
                this.tokenRepository.find(),
                Promise.resolve(this.priceService.getPrices()),
            ],
        );

        const tokenMap = new Map(tokens.map((t) => [t.id, t]));
        const priceMap = new Map<string, number>();
        for (const t of tokens) {
            const p = allPrices[t.id.toLowerCase()];
            if (p !== undefined) priceMap.set(t.id, p);
        }

        // Fetch LTV from risk table for collateral tokens (token.averageLTV is only set for loan tokens)
        const collateralAssetIds = collateralRows.map((r) => r.asset_id);
        const riskParams =
            collateralAssetIds.length > 0
                ? await this.portfolioRepository.getRiskParamsByCollateralTokenIds(
                      collateralAssetIds,
                  )
                : [];
        const riskLtvMap = new Map(
            riskParams.map((r) => [r.asset_id, Number(r.avg_ltv)]),
        );

        const collateralPositions: CollateralPositionInput[] = [];
        for (const row of collateralRows) {
            const token = tokenMap.get(row.asset_id);
            const decimals = token?.decimals ?? 0;
            const priceUsd = priceMap.get(row.asset_id) ?? 0;
            const ltvBps =
                riskLtvMap.get(row.asset_id) ??
                (token?.averageLTV != null ? Number(token.averageLTV) : 0);
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
            const openOrders =
                await this.orderRepository.getOpenBorrowOrders(accountId);
            for (const order of openOrders) {
                const token = tokenMap.get(order.assetId);
                const decimals = token?.decimals ?? 0;
                const priceUsd = priceMap.get(order.assetId) ?? 0;

                const remainingAmountBaseUnits = (
                    BigInt(order.quantity) - BigInt(order.filledQuantity)
                ).toString();

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
            additionalDebtPositions:
                additionalDebtPositions.length > 0
                    ? additionalDebtPositions
                    : undefined,
        };
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
    ): Promise<void> {
        const portfolioBalanceRaw = await this.getAssetBalance(
            accountId,
            assetId,
        );
        const portfolioBalance = BigInt(portfolioBalanceRaw);

        const totalOpenOrders = await this.orderRepository.getTotalOpenQuantity(
            accountId,
            assetId,
            OrderSide.Lend,
        );

        const availableBalance = portfolioBalance - totalOpenOrders;

        if (BigInt(quantityBaseUnits) > availableBalance) {
            throw new BadRequestException(
                "Insufficient portfolio balance for this order",
            );
        }
    }

    async getMyAssets(
        wallet: string,
        query: GetMyAssetsQueryDto,
    ): Promise<MyAssetsResponseDto> {
        const { page = 1, limit = 10 } = query;

        const account = await this.orderRepository.findAccountByWallet(wallet);
        if (!account) {
            return createPaginatedResponse([], 0, page, limit);
        }

        const { data: userAssets, total } =
            await this.portfolioRepository.getUserAssets(
                account.id,
                page,
                limit,
            );

        if (userAssets.length === 0) {
            return createPaginatedResponse([], total, page, limit);
        }

        const assetIds = userAssets.map((ua) => ua.asset_id);
        const [tokens, riskParams] = await Promise.all([
            this.portfolioRepository.getTokensByAssetIds(assetIds),
            this.portfolioRepository.getRiskParamsByCollateralTokenIds(
                assetIds,
            ),
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
                assetId: ua.asset_id,
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

    async getMyPosition(
        wallet: string,
        query: MyPositionQueryDto,
    ): Promise<GetMyPositionResponseDto> {
        const { page = 1, limit = 10, type, assetId } = query;

        const account = await this.orderRepository.findAccountByWallet(wallet);
        if (!account) {
            throw new NotFoundException("Account not found");
        }

        const { data: positions, total } =
            await this.portfolioRepository.getUserPositions(
                account.id,
                type,
                page,
                limit,
                assetId,
            );

        if (positions.length === 0) {
            return createPaginatedResponse([], total, page, limit);
        }

        const allPrices = this.priceService.getPrices();

        const data = positions.map((position) => {
            const price = allPrices[position.asset_id.toLowerCase()];
            const decimals = Number(position.decimals) || 0;
            const quantityHuman = Number(
                baseUnitsToHuman(position.quantity, decimals),
            );

            return {
                id: position.position_id,
                symbol: position.symbol,
                name: position.name,
                walletBalance: quantityHuman,
                amountInUsd: calculateUsdAmount(quantityHuman, price ?? 0),
                isCollateral: false,
                imageUrl: position.image_url ?? null,
                side: position.side as "LEND" | "BORROW",
                maturity: position.maturity
                    ? new Date(position.maturity).getTime() / 1000
                    : null,
                apr: Number(position.rate) || 0,
            };
        });

        return createPaginatedResponse(data, total, page, limit);
    }

    async setAssetAsCollateral(
        wallet: string,
        body: SetAssetAsCollateralDto,
    ): Promise<void> {
        if (
            !body ||
            !body.assetIds ||
            !Array.isArray(body.assetIds) ||
            body.assetIds.length === 0
        ) {
            throw new Error("Invalid request body: assetIds array is required");
        }

        const account = await this.orderRepository.findAccountByWallet(wallet);
        if (!account) {
            throw new NotFoundException("Account not found");
        }

        await this.portfolioRepository.setAssetAsCollateral(
            account.id,
            body.assetIds,
            body.isCollateral,
        );
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
            );

        const items: TransactionHistoryItem[] = rows.map((row) => ({
            id: row.id,
            side: row.side,
            orderType: row.order_type,
            rate: Number(row.rate) || 0,
            amount: baseUnitsToHuman(row.amount, Number(row.decimals) || 0),
            filledQuantity: row.filled_quantity
                ? baseUnitsToHuman(
                      row.filled_quantity,
                      Number(row.decimals) || 0,
                  )
                : null,
            status: row.status,
            asset: {
                id: row.asset_id,
                name: row.name,
                symbol: row.symbol,
                decimals: Number(row.decimals) || 0,
                imageUrl: row.image_url,
                tokenAddress: row.token_address,
            },
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
                },
            );

        const items: OpenOrderItem[] = rows.map((row) => ({
            id: row.id,
            side: row.side,
            orderType: row.order_type,
            rate: Number(row.rate) || 0,
            amount: baseUnitsToHuman(row.amount, Number(row.decimals) || 0),
            filledQuantity: row.filled_quantity
                ? baseUnitsToHuman(
                      row.filled_quantity,
                      Number(row.decimals) || 0,
                  )
                : null,
            status: row.status,
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

    async withdrawLendPosition(
        dto: WithdrawLendPositionDto,
        walletAddress: string,
        privyUserId: string,
    ): Promise<WithdrawLendPositionResponseDto> {
        const { marketId } = dto;

        const accountId = await this.orderRepository
            .getOrCreateAccount(walletAddress, privyUserId)
            .then((a) => a.id);

        const market = await this.marketRepository.getMarketWithAsset(marketId);
        if (!market) {
            throw new NotFoundException("Market not found");
        }

        const positions = await this.portfolioRepository.getLendPositions(
            accountId,
            marketId,
        );
        if (!positions || positions.length === 0) {
            throw new BadRequestException(
                "No active lend positions found for this market",
            );
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

        let totalShares = 0n;
        for (const pos of positions) {
            const sharesStr = pos.lp_shares.toString().split(".")[0];
            totalShares += BigInt(sharesStr);
        }

        if (totalShares <= 0n) {
            throw new BadRequestException("No shares available for withdrawal");
        }

        this.logger.log(
            `Executing withdrawLendPosition: token=${market.tokenAddress}, maturity=${maturityUnix}, cbtAmount=${totalShares}`,
        );

        const receipt = await this.executeBlockchainWithdraw(
            market.tokenAddress,
            BigInt(maturityUnix),
            totalShares,
        );

        const { amountWithdrawn } = this.parseWithdrawEvent(receipt);

        await this.updateDatabaseState(
            positions,
            receipt,
            accountId,
            market.assetId,
            walletAddress,
            market.tokenAddress,
            amountWithdrawn,
        );

        return {
            txHash: receipt.transactionHash,
            status: "success",
        };
    }

    private async executeBlockchainWithdraw(
        loanToken: string,
        maturity: bigint,
        cbtAmount: bigint,
    ): Promise<TransactionReceipt> {
        try {
            const receipt = (await this.viemService.writeContract(
                this.chainId,
                this.operatorPrivateKey,
                this.centuariAddress,
                centuariAbi,
                "withdrawLendPosition",
                [loanToken, maturity, cbtAmount],
                { waitForReceipt: true },
            )) as TransactionReceipt;
            return receipt;
        } catch (error: any) {
            this.logger.error(`Contract call failed: ${error.message}`);
            if (error.message.includes("NotMatured")) {
                throw new BadRequestException(
                    "Contract reverted: position has not matured yet.",
                );
            }
            if (error.message.includes("InsufficientBalance")) {
                throw new BadRequestException(
                    "Contract reverted: insufficient CBT balance.",
                );
            }
            throw new InternalServerErrorException(
                `Blockchain transaction failed: ${error.message}`,
            );
        }
    }

    private parseWithdrawEvent(receipt: TransactionReceipt): {
        cbtBurned: bigint;
        amountWithdrawn: bigint;
    } {
        try {
            const event = getFirstEventFromReceipt<{
                cbtBurned: bigint;
                amountWithdrawn: bigint;
            }>(receipt, centuariAbi, "LendPositionWithdrawn");
            return event.args;
        } catch {
            throw new InternalServerErrorException(
                "No LendPositionWithdrawn event found in transaction receipt",
            );
        }
    }

    private async updateDatabaseState(
        positions: any[],
        receipt: TransactionReceipt,
        accountId: string,
        assetId: string,
        walletAddress: string,
        tokenAddress: string,
        amountWithdrawn: bigint,
    ): Promise<void> {
        const txHash = receipt.transactionHash;
        try {
            await this.dataSource.transaction(async (manager) => {
                const lockedPositions =
                    await this.portfolioRepository.getLendPositions(
                        positions[0].lp_account_id,
                        positions[0].lp_market_id,
                        manager,
                    );

                for (const pos of lockedPositions) {
                    await this.portfolioRepository.updateLendPositionShares(
                        manager,
                        pos.lp_id,
                        "0",
                    );
                }
            });

            const portfolioId = portfolioUuidFor(
                walletAddress.toLowerCase(),
                tokenAddress.toLowerCase(),
            );
            await this.portfolioRepository.upsertPortfolio(
                portfolioId,
                accountId,
                assetId,
                amountWithdrawn.toString(),
            );

            this.logger.log(
                `Withdraw lend position DB state updated for tx: ${txHash}, portfolio credited: ${amountWithdrawn}`,
            );
        } catch (error: any) {
            this.logger.error(
                `CRITICAL: Blockchain tx succeeded (${txHash}) but DB update failed: ${error.message}`,
            );
            throw new InternalServerErrorException(
                "Withdraw finalized on-chain but failed local state update.",
            );
        }
    }

    async getUserDetails(wallet: string): Promise<UserDetailsResponseDto> {
        const account = await this.orderRepository.findAccountByWallet(wallet);
        if (!account) {
            throw new NotFoundException("Account not found");
        }

        const [
            portfolioBalances,
            openLendAmounts,
            borrowedAssets,
            openBorrowOrders,
            userAssets,
            tokens,
        ] = await Promise.all([
            this.portfolioRepository.getUserTotalBalances(account.id),
            this.orderRepository.getOpenLendAmountsByAccount(account.id),
            this.portfolioRepository.getUserBorrowedAssets(account.id),
            this.orderRepository.getOpenBorrowOrders(account.id),
            this.portfolioRepository.getUserAssets(account.id, 1, 1000),
            this.tokenRepository.find(),
        ]);

        const allPrices = this.priceService.getPrices();
        const tokenMap = new Map(tokens.map((t) => [t.id, t]));

        // Build locked lend amounts map: assetId -> locked base units
        const lockedMap = new Map<string, string>();
        for (const row of openLendAmounts) {
            lockedMap.set(row.assetId, row.lockedAmount);
        }

        // Build collateral status map from user assets
        const collateralMap = new Map<string, boolean>();
        for (const ua of userAssets.data) {
            collateralMap.set(ua.asset_id, !!ua.is_collateral);
        }

        // Get risk params for all portfolio asset IDs
        const assetIds = portfolioBalances.map((b) => b.asset_id);
        const riskParams =
            assetIds.length > 0
                ? await this.portfolioRepository.getRiskParamsByCollateralTokenIds(
                      assetIds,
                  )
                : [];
        const riskMap = new Map(riskParams.map((r) => [r.asset_id, r]));

        // Build asset details
        const assets = portfolioBalances.map((balance) => {
            const token = tokenMap.get(balance.asset_id);
            const decimals = token?.decimals ?? 0;
            const risk = riskMap.get(balance.asset_id);
            const price = allPrices[balance.asset_id.toLowerCase()] ?? 0;

            const totalBalanceHuman = Number(
                baseUnitsToHuman(balance.total_amount, decimals),
            );

            const lockedBaseUnits = lockedMap.get(balance.asset_id) ?? "0";
            const lockedHuman = Number(
                baseUnitsToHuman(lockedBaseUnits, decimals),
            );

            const availableBalance = Math.max(
                0,
                totalBalanceHuman - lockedHuman,
            );
            const availableBalanceUsd = availableBalance * price;

            const ltv = risk ? Number(risk.avg_ltv) / 10000 : 0;
            const liquidationThreshold = risk ? Number(risk.avg_lt) / 10000 : 0;

            return {
                assetId: balance.asset_id,
                totalBalance: totalBalanceHuman,
                lockedInOrders: lockedHuman,
                availableBalance,
                availableBalanceUsd: Number(availableBalanceUsd.toFixed(2)),
                isCollateral: collateralMap.get(balance.asset_id) ?? false,
                ltv,
                liquidationThreshold,
            };
        });

        // Compute settled debt
        let settledDebtUsd = 0;
        const debts: {
            assetId: string;
            debtAmount: number;
            debtAmountUsd: number;
        }[] = [];
        for (const row of borrowedAssets) {
            const token = tokenMap.get(row.asset_id);
            const decimals = token?.decimals ?? 0;
            const price = allPrices[row.asset_id.toLowerCase()] ?? 0;
            const debtHuman = Number(baseUnitsToHuman(row.amount, decimals));
            const debtUsd = debtHuman * price;
            settledDebtUsd += debtUsd;
            debts.push({
                assetId: row.asset_id,
                debtAmount: debtHuman,
                debtAmountUsd: Number(debtUsd.toFixed(2)),
            });
        }

        // Compute pending debt from open borrow orders
        let pendingDebtUsd = 0;
        for (const order of openBorrowOrders) {
            const token = tokenMap.get(order.assetId);
            const decimals = token?.decimals ?? 0;
            const price = allPrices[order.assetId.toLowerCase()] ?? 0;
            const remainingBaseUnits = (
                BigInt(order.quantity) - BigInt(order.filledQuantity)
            ).toString();
            const remainingHuman = Number(
                baseUnitsToHuman(remainingBaseUnits, decimals),
            );
            pendingDebtUsd += remainingHuman * price;
        }

        const totalDebtUsd = settledDebtUsd + pendingDebtUsd;

        return {
            assets,
            totalDebtUsd: Number(totalDebtUsd.toFixed(2)),
            settledDebtUsd: Number(settledDebtUsd.toFixed(2)),
            pendingDebtUsd: Number(pendingDebtUsd.toFixed(2)),
            debts,
        };
    }
}
