import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { ConfigService } from "@nestjs/config";
import type { TransactionReceipt } from "viem";
import { ViemService } from "../core/viem/viem.service";
import { FaucetService } from "../faucet/faucet.service";
import { erc20Abi } from "../abis/ERC20";
import { treasuryAbi } from "../abis/Treasury";
import { privateKeyToAccount } from "viem/accounts";
import { keccak256, parseEventLogs, toHex } from "viem";
import { OrderRepository } from "./repositories/order.repository";
import { PortfolioRepository } from "../portfolio/repositories/portfolio.repository";
import { portfolioUuidFor } from "../common/utils/uuid.utils";
import { OrdersService } from "./orders.service";
import { Market } from "../market/entities/market.entity";
import { Token } from "../tokens/entities/token.entity";
import { PortfolioService } from "../portfolio/portfolio.service";
import { TokensService } from "../tokens/tokens.service";
import { OrderSide } from "./constants/order.constants";
import { humanToBaseUnits } from "../common/utils/number.utils";
import { PriceService } from "../price/price.service";
import { HEALTH_FACTOR_NO_DEBT } from "../portfolio/helpers/health-factor.helpers";

const LEND_INSERT_INTERVAL_MS = 15000;
const BORROW_INSERT_INTERVAL_MS = 15000;
const CACHE_REFRESH_INTERVAL_MS = 60000;

const LEND_RATE_MIN = 500;
const LEND_RATE_MAX = 1500;
const BORROW_RATE_MIN = 500;
const BORROW_RATE_MAX = 1500;
const LEND_QUANTITY_USD_MIN = 10;
const LEND_QUANTITY_USD_MAX = 500;
const BORROW_QUANTITY_USD_MIN = 10;
const BORROW_QUANTITY_USD_MAX = 200;
const MARKET_ORDER_PROBABILITY = 0.05;

const NUM_BOT_ACCOUNTS = 6;
const MIN_GAS_BALANCE_WEI = BigInt(1e15); // ~0.001 ETH

interface BotAccount {
    privateKey: string;
    wallet: string;
    privyUserId: string;
}

interface TokenFundingSpec {
    assetId: string;
    tokenAddress: string;
    decimals: number;
    isCollateral: boolean;
}

@Injectable()
export class OrdersWorker implements OnModuleInit {
    private readonly logger = new Logger(OrdersWorker.name);
    private assetMarketCache: Array<{
        assetId: string;
        symbol: string;
        marketIds: string[];
    }> = [];
    private botAccounts: BotAccount[] = [];
    private chainId: number;
    private treasuryAddress: string;

    constructor(
        private readonly orderRepository: OrderRepository,
        @InjectRepository(Market)
        private readonly marketRepository: Repository<Market>,
        @InjectRepository(Token)
        private readonly tokenRepository: Repository<Token>,
        private readonly ordersService: OrdersService,
        private readonly viemService: ViemService,
        private readonly faucetService: FaucetService,
        private readonly configService: ConfigService,
        private readonly portfolioService: PortfolioService,
        private readonly portfolioRepository: PortfolioRepository,
        private readonly tokensService: TokensService,
        private readonly priceService: PriceService,
    ) {}

    private initialized = false;
    private readonly topUpInProgress = new Set<string>();

    async onModuleInit(): Promise<void> {
        if (!this.isEnabled) {
            this.logger.log(
                "OrdersWorker is disabled (NODE_ENV or ORDER_WORKER_ENABLED).",
            );
            return;
        }
        this.logger.log("OrdersWorker enabled — scheduling background initialization.");

        this.chainId = Number(this.configService.get<string>("DEPOSIT_CHAIN_ID") ?? "421614");
        this.treasuryAddress =
            this.configService.get<string>("TREASURY_ADDRESS") ??
            (() => {
                throw new Error("TREASURY_ADDRESS is not configured");
            })();

        this.botAccounts = this.deriveBotAccounts();

        // Run heavy init in background so the HTTP server starts immediately
        this.initializeInBackground();
    }

    private initializeInBackground(): void {
        (async () => {
            try {
                await this.ensureAccountsExist();
                await this.refreshAssetMarketCache();
                await this.seedBotFunding();
                this.initialized = true;
                this.logger.log("OrdersWorker initialized — placing orders.");
            } catch (e) {
                this.logger.error(
                    `OrdersWorker background initialization failed: ${(e as Error).message}`,
                );
            }
        })();
    }

    private get isEnabled(): boolean {
        if (process.env.NODE_ENV === "production") return false;
        return process.env.ORDER_WORKER_ENABLED === "true";
    }

    /**
     * Converts a human-readable token amount (possibly a float) to base units as bigint,
     * truncating any excess decimal places beyond the token's decimals.
     */
    private humanAmountToBaseUnitsBigInt(amount: number, decimals: number): bigint {
        const truncated = amount.toFixed(decimals);
        return BigInt(humanToBaseUnits(truncated, decimals));
    }

    private async usdToTokenAmount(usdAmount: number, assetId: string): Promise<number> {
        const price = await this.priceService.getPrice(assetId);
        if (price == null || price <= 0) {
            this.logger.warn(
                `[OrdersWorker] No price for asset ${assetId}; falling back to raw USD value as token amount`,
            );
            return usdAmount;
        }
        const tokenAmount = usdAmount / price;
        this.logger.debug(
            `[OrdersWorker] USD→Token: $${usdAmount} / $${price} = ${tokenAmount.toFixed(2)} tokens for asset ${assetId}`,
        );
        return tokenAmount;
    }

    private deriveBotAccounts(): BotAccount[] {
        const operatorKey = this.configService.get<string>("OPERATOR_PRIVATE_KEY");
        if (!operatorKey) {
            throw new Error("OPERATOR_PRIVATE_KEY is not configured");
        }
        const formattedKey = operatorKey.startsWith("0x") ? operatorKey : `0x${operatorKey}`;
        return Array.from({ length: NUM_BOT_ACCOUNTS }, (_, i) => {
            const derivedKey = keccak256(toHex(`${formattedKey}-bot-${i}`));
            const account = privateKeyToAccount(derivedKey as `0x${string}`);
            return {
                privateKey: derivedKey,
                wallet: account.address,
                privyUserId: `did:privy:worker-bot-${i}`,
            };
        });
    }

    private async ensureAccountsExist(): Promise<void> {
        for (const bot of this.botAccounts) {
            await this.orderRepository.getOrCreateAccount(bot.wallet, bot.privyUserId);
        }
        this.logger.log(`Ensured ${this.botAccounts.length} bot accounts exist in DB`);
    }

    // ─── Seed Funding (one-shot on init) ──────────────────────────────

    /**
     * One-shot seed funding: call faucet once per bot, deposit everything into Treasury.
     */
    private async seedBotFunding(): Promise<void> {
        const operatorKey = this.configService.get<string>("OPERATOR_PRIVATE_KEY");
        if (!operatorKey) {
            this.logger.error("OPERATOR_PRIVATE_KEY is not configured; cannot fund bots");
            return;
        }
        const formattedKey = operatorKey.startsWith("0x") ? operatorKey : `0x${operatorKey}`;

        const assetIds = Array.from(new Set(this.assetMarketCache.map((e) => e.assetId)));
        const tokens = await this.tokenRepository.find({
            where: { id: In(assetIds) },
        });
        const tokenById = new Map(tokens.map((t) => [t.id, t]));

        const collateralTokens = await this.tokenRepository.find({
            where: {
                isLoanToken: false,
                chainId: this.chainId as unknown as number,
            },
        });

        // Build specs for all tokens (loan + collateral)
        const collateralAddressSet = new Set(
            collateralTokens.map((t) => t.tokenAddress?.toLowerCase()),
        );
        const allSpecs: TokenFundingSpec[] = [];
        for (const assetId of assetIds) {
            const token = tokenById.get(assetId);
            if (!token?.tokenAddress || token.decimals == null) continue;
            allSpecs.push({
                assetId: token.id,
                tokenAddress: token.tokenAddress,
                decimals: token.decimals,
                isCollateral: collateralAddressSet.has(token.tokenAddress.toLowerCase()),
            });
        }
        for (const token of collateralTokens) {
            if (!token.tokenAddress || token.decimals == null) continue;
            // Avoid duplicates
            if (allSpecs.some((s) => s.tokenAddress === token.tokenAddress)) continue;
            allSpecs.push({
                assetId: token.id,
                tokenAddress: token.tokenAddress,
                decimals: token.decimals,
                isCollateral: true,
            });
        }

        const collateralAssetIds = collateralTokens.map((t) => t.id);

        for (const bot of this.botAccounts) {
            try {
                await this.ensureGasForBot(formattedKey, bot.wallet);
                await this.faucetAndDeposit(bot, allSpecs, collateralAssetIds);
            } catch (e) {
                this.logger.error(
                    `Failed seed funding for bot ${bot.wallet}: ${(e as Error).message}`,
                );
            }
        }
    }

    // ─── Faucet + Deposit (single round) ──────────────────────────────

    /**
     * Call faucet once for all tokens, deposit whatever was received into Treasury,
     * sync portfolio, and set collateral.
     */
    private async faucetAndDeposit(
        bot: BotAccount,
        specs: TokenFundingSpec[],
        collateralAssetIds: string[] = [],
    ): Promise<void> {
        if (specs.length === 0) return;

        // Filter to Treasury-supported tokens
        const supportedResults = await Promise.all(
            specs.map((s) =>
                this.viemService
                    .readContract<boolean>(
                        this.chainId,
                        this.treasuryAddress,
                        treasuryAbi,
                        "supportedToken",
                        [s.tokenAddress],
                    )
                    .then((supported) => ({ ...s, supported }))
                    .catch(() => ({ ...s, supported: false })),
            ),
        );
        const supportedSpecs = supportedResults.filter((r) => r.supported);

        if (supportedSpecs.length === 0) {
            this.logger.debug(
                `No Treasury-supported tokens to fund for bot ${bot.wallet}; skipping`,
            );
            return;
        }

        const specByToken = new Map(
            supportedSpecs.map((s) => [s.tokenAddress.toLowerCase(), s]),
        );
        const tokenAddresses = supportedSpecs.map((s) => s.tokenAddress);

        // Ensure max approval for each token
        for (const spec of supportedSpecs) {
            const allowance = await this.viemService.readContract<bigint>(
                this.chainId,
                spec.tokenAddress,
                erc20Abi,
                "allowance",
                [bot.wallet, this.treasuryAddress],
            );
            if (allowance === 0n) {
                await this.writeContractWithNonceRetry(
                    bot.privateKey,
                    spec.tokenAddress,
                    erc20Abi,
                    "approve",
                    [
                        this.treasuryAddress,
                        BigInt(
                            "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
                        ),
                    ],
                );
                await new Promise((r) => setTimeout(r, 1500));
            }
        }

        // Call faucet once for all tokens
        try {
            await this.faucetService.requestTokensBatch(
                this.chainId,
                bot.wallet,
                tokenAddresses,
            );
        } catch (e) {
            this.logger.warn(
                `Faucet request failed for bot ${bot.wallet}: ${(e as Error).message}`,
            );
        }

        // Deposit whatever wallet balance we have into Treasury
        const account = await this.orderRepository.findAccountByWallet(bot.wallet);

        for (const spec of supportedSpecs) {
            try {
                const walletBalance = await this.viemService.readContract<bigint>(
                    this.chainId,
                    spec.tokenAddress,
                    erc20Abi,
                    "balanceOf",
                    [bot.wallet],
                );
                if (walletBalance === 0n) continue;

                const receipt = await this.writeContractWithNonceRetry(
                    bot.privateKey,
                    this.treasuryAddress,
                    treasuryAbi,
                    "deposit",
                    [spec.tokenAddress, walletBalance],
                );

                // Update portfolio from deposit event
                if (account) {
                    try {
                        const depositedLogs = parseEventLogs({
                            abi: treasuryAbi,
                            eventName: "Deposited",
                            logs: receipt.logs,
                        }).filter(
                            (log) =>
                                log.address?.toLowerCase() ===
                                this.treasuryAddress.toLowerCase(),
                        );

                        for (const log of depositedLogs) {
                            const userWallet = (
                                log.args as { user: string }
                            ).user.toLowerCase();
                            const tokenAddr = (
                                log.args as { token: string }
                            ).token.toLowerCase();
                            const amount = (
                                log.args as { amount: bigint }
                            ).amount.toString();
                            const specForLog = specByToken.get(tokenAddr);
                            const assetId = specForLog?.assetId ?? spec.assetId;
                            const portfolioId = portfolioUuidFor(
                                userWallet,
                                tokenAddr,
                            );
                            await this.portfolioRepository.upsertPortfolio(
                                portfolioId,
                                account.id,
                                assetId,
                                amount,
                            );
                        }
                    } catch (e) {
                        this.logger.error(
                            `Failed to upsert portfolio after deposit for bot ${bot.wallet} token ${spec.tokenAddress}: ${(e as Error).message}`,
                        );
                    }
                }
            } catch (e) {
                this.logger.error(
                    `Failed to deposit token ${spec.tokenAddress} for bot ${bot.wallet}: ${(e as Error).message}`,
                );
            }
        }

        // Sync portfolio from on-chain balance for all supported tokens
        await Promise.all(
            supportedSpecs.map((s) =>
                this.syncPortfolioFromOnChainBalance(bot, s.assetId, s.tokenAddress, s.isCollateral),
            ),
        );

        this.logger.log(
            `Faucet + deposit complete for bot ${bot.wallet} (${supportedSpecs.length} token(s))`,
        );

        // Set collateral
        if (collateralAssetIds.length > 0) {
            try {
                await this.portfolioService.setAssetAsCollateral(bot.wallet, {
                    assetIds: collateralAssetIds,
                    isCollateral: true,
                });
            } catch (e) {
                this.logger.error(
                    `Failed to set collateral for bot ${bot.wallet}: ${(e as Error).message}`,
                );
            }
        }
    }

    private async ensureGasForBot(operatorKey: string, botAddress: string): Promise<void> {
        try {
            const publicClient = this.viemService.getPublicClient(this.chainId);
            const balance = await publicClient.getBalance({
                address: botAddress as `0x${string}`,
            });
            if (balance >= MIN_GAS_BALANCE_WEI) return;

            const operatorAccount = privateKeyToAccount(
                (operatorKey.startsWith("0x") ? operatorKey : `0x${operatorKey}`) as `0x${string}`,
            );
            const walletClient = this.viemService.getWalletClient(operatorKey, this.chainId);
            const hash = await walletClient.sendTransaction({
                account: operatorAccount,
                to: botAddress as `0x${string}`,
                value: MIN_GAS_BALANCE_WEI,
            });
            await publicClient.waitForTransactionReceipt({ hash });
            this.logger.log(`Sent gas to bot ${botAddress} (tx: ${hash})`);
        } catch (e) {
            this.logger.error(
                `Failed to fund gas for bot ${botAddress}: ${(e as Error).message}`,
            );
        }
    }

    /**
     * Syncs portfolio DB row from on-chain treasury balance.
     * Ensures DB reflects on-chain state regardless of event parsing.
     */
    private async syncPortfolioFromOnChainBalance(
        bot: BotAccount,
        assetId: string,
        tokenAddress: string,
        isCollateral: boolean = false,
    ): Promise<void> {
        try {
            const onChainBalance = await this.viemService.readContract<bigint>(
                this.chainId,
                this.treasuryAddress,
                treasuryAbi,
                "balanceOf",
                [bot.wallet, tokenAddress],
            );
            if (onChainBalance === 0n) return;

            const account = await this.orderRepository.findAccountByWallet(bot.wallet);
            if (!account) return;

            const portfolioId = portfolioUuidFor(
                bot.wallet.toLowerCase(),
                tokenAddress.toLowerCase(),
            );
            await this.portfolioRepository.syncPortfolioBalance(
                portfolioId,
                account.id,
                assetId,
                onChainBalance.toString(),
                isCollateral,
            );
            this.logger.debug(
                `Synced portfolio for bot ${bot.wallet} token ${tokenAddress}: amount=${onChainBalance.toString()}`,
            );
        } catch (e) {
            this.logger.error(
                `Failed to sync portfolio from on-chain balance for bot ${bot.wallet} token ${tokenAddress}: ${(e as Error).message}`,
            );
        }
    }

    // ─── On-demand top-ups (single faucet call) ──────────────────────

    /**
     * On-demand collateral top-up: faucet once + deposit for a single bot.
     */
    private async topUpCollateralForBot(bot: BotAccount): Promise<void> {
        if (this.topUpInProgress.has(bot.wallet)) return;
        this.topUpInProgress.add(bot.wallet);
        try {
            const operatorKey = this.configService.get<string>("OPERATOR_PRIVATE_KEY");
            if (!operatorKey) return;
            const formattedKey = operatorKey.startsWith("0x") ? operatorKey : `0x${operatorKey}`;

            const collateralTokens = await this.tokenRepository.find({
                where: {
                    isLoanToken: false,
                    chainId: this.chainId as unknown as number,
                },
            });
            if (collateralTokens.length === 0) return;

            await this.ensureGasForBot(formattedKey, bot.wallet);

            const specs: TokenFundingSpec[] = collateralTokens
                .filter((t) => t.tokenAddress && t.decimals != null)
                .map((t) => ({
                    assetId: t.id,
                    tokenAddress: t.tokenAddress!,
                    decimals: t.decimals!,
                    isCollateral: true,
                }));

            const collateralAssetIds = collateralTokens.map((t) => t.id);
            await this.faucetAndDeposit(bot, specs, collateralAssetIds);
            this.logger.log(`[topUpCollateral] Topped up collateral for bot ${bot.wallet}`);
        } finally {
            this.topUpInProgress.delete(bot.wallet);
        }
    }

    /**
     * On-demand loan token top-up: faucet once + deposit for a single bot and token.
     */
    private async topUpLoanTokenForBot(bot: BotAccount, assetId: string): Promise<void> {
        const key = `lend-${bot.wallet}`;
        if (this.topUpInProgress.has(key)) return;
        this.topUpInProgress.add(key);
        try {
            const operatorKey = this.configService.get<string>("OPERATOR_PRIVATE_KEY");
            if (!operatorKey) return;
            const formattedKey = operatorKey.startsWith("0x")
                ? operatorKey
                : `0x${operatorKey}`;

            const token = await this.tokenRepository.findOne({ where: { id: assetId } });
            if (!token?.tokenAddress || token.decimals == null) return;

            await this.ensureGasForBot(formattedKey, bot.wallet);

            const specs: TokenFundingSpec[] = [
                {
                    assetId: token.id,
                    tokenAddress: token.tokenAddress,
                    decimals: token.decimals,
                    isCollateral: false,
                },
            ];

            await this.faucetAndDeposit(bot, specs, []);
            this.logger.log(
                `[topUpLoanToken] Topped up loan token ${token.symbol} for bot ${bot.wallet}`,
            );
        } finally {
            this.topUpInProgress.delete(key);
        }
    }

    // ─── Cache ───────────────────────────────────────────────────────────

    @Interval(CACHE_REFRESH_INTERVAL_MS)
    async refreshAssetMarketCache(): Promise<void> {
        if (!this.isEnabled) return;

        try {
            const markets = await this.marketRepository.find();
            const tokens = await this.tokenRepository.find();
            const tokenSymbolMap = new Map<string, string>();
            for (const t of tokens) {
                tokenSymbolMap.set(t.id, t.symbol);
            }

            const grouped = new Map<string, string[]>();
            for (const m of markets) {
                const arr = grouped.get(m.assetId) ?? [];
                arr.push(m.id);
                grouped.set(m.assetId, arr);
            }
            this.assetMarketCache = Array.from(grouped.entries()).map(
                ([assetId, marketIds]) => ({
                    assetId,
                    symbol: tokenSymbolMap.get(assetId) ?? "UNKNOWN",
                    marketIds,
                }),
            );
            this.logger.debug(
                `Asset/market cache refreshed: ${this.assetMarketCache.map((e) => e.symbol).join(", ")}`,
            );
        } catch (error) {
            this.logger.error(
                `Failed to refresh asset/market cache: ${(error as Error).message}`,
            );
        }
    }

    // ─── Create LEND orders (one per loan token per interval) ─────────

    @Interval(LEND_INSERT_INTERVAL_MS)
    async createLendOrders(): Promise<void> {
        if (!this.isEnabled || !this.initialized) return;
        if (this.assetMarketCache.length === 0) {
            this.logger.warn(
                "[OrdersWorker] createLendOrders skipped: assetMarketCache is empty (no markets in DB)",
            );
            return;
        }

        for (const entry of this.assetMarketCache) {
            try {
                const { assetId, marketIds, symbol } = entry;
                const lendMin = await this.usdToTokenAmount(LEND_QUANTITY_USD_MIN, assetId);
                const lendMax = await this.usdToTokenAmount(LEND_QUANTITY_USD_MAX, assetId);
                const amount = this.randomQuantity(lendMin, lendMax);

                const decimals = await this.tokensService.getTokenDecimalsByAssetId(assetId);
                if (decimals == null) {
                    this.logger.debug(
                        `[OrdersWorker] Skipping lend for ${symbol}: no decimals for asset ${assetId}`,
                    );
                    continue;
                }
                const quantityBaseUnits = humanToBaseUnits(amount, decimals);
                let account = await this.pickAccountWithSufficientBalanceForLend(
                    assetId,
                    quantityBaseUnits,
                );
                if (!account) {
                    // Top up once and retry
                    const fallbackBot = this.pickAvailableBotForTopUp("lend");
                    if (fallbackBot) {
                        this.logger.debug(
                            `[OrdersWorker] No bot with sufficient balance for ${symbol}; topping up for ${fallbackBot.wallet}`,
                        );
                        await this.topUpLoanTokenForBot(fallbackBot, assetId);
                        account = await this.pickAccountWithSufficientBalanceForLend(
                            assetId,
                            quantityBaseUnits,
                        );
                    }
                }
                if (!account) {
                    this.logger.debug(
                        `[OrdersWorker] No bot with sufficient balance for ${symbol} amount=${amount} after top-up; skipping`,
                    );
                    continue;
                }

                if (Math.random() < MARKET_ORDER_PROBABILITY) {
                    await this.ordersService.createLendMarketOrder(
                        { assetId, amount, marketIds },
                        account.wallet,
                        account.privyUserId,
                    );
                    this.logger.debug(`[LEND MARKET] ${symbol} amount=${amount}`);
                } else {
                    const rate = this.randomRate(LEND_RATE_MIN, LEND_RATE_MAX);
                    await this.ordersService.createLendLimitOrder(
                        { assetId, amount, marketIds, rate },
                        account.wallet,
                        account.privyUserId,
                    );
                    this.logger.debug(`[LEND LIMIT] ${symbol} amount=${amount} rate=${rate}bp`);
                }
            } catch (error) {
                this.logger.warn(
                    `[OrdersWorker] Failed lend order for ${entry.symbol}: ${(error as Error).message}`,
                );
            }
        }
    }

    // ─── Create BORROW orders (one per loan token per interval) ───────

    @Interval(BORROW_INSERT_INTERVAL_MS)
    async createBorrowOrders(): Promise<void> {
        if (!this.isEnabled || !this.initialized) return;
        if (this.assetMarketCache.length === 0) {
            this.logger.warn(
                "[OrdersWorker] createBorrowOrders skipped: assetMarketCache is empty",
            );
            return;
        }

        for (const entry of this.assetMarketCache) {
            try {
                const { assetId, marketIds, symbol } = entry;
                const borrowMin = await this.usdToTokenAmount(BORROW_QUANTITY_USD_MIN, assetId);
                const borrowMax = await this.usdToTokenAmount(BORROW_QUANTITY_USD_MAX, assetId);
                const amount = this.randomQuantity(borrowMin, borrowMax);

                let account = await this.pickAccountWithSufficientHealthForBorrow(assetId, amount);
                if (!account) {
                    // Top up collateral once and retry
                    const fallbackBot = this.pickAvailableBotForTopUp();
                    if (!fallbackBot) {
                        this.logger.debug(
                            `[OrdersWorker] No bot available for borrow top-up (all in progress); skipping ${symbol}`,
                        );
                        continue;
                    }
                    this.logger.debug(
                        `[OrdersWorker] No bot with sufficient HF for ${symbol} amount=${amount}; topping up collateral for ${fallbackBot.wallet}`,
                    );
                    await this.topUpCollateralForBot(fallbackBot);
                    account = await this.pickAccountWithSufficientHealthForBorrow(assetId, amount);
                }
                if (!account) {
                    this.logger.debug(
                        `[OrdersWorker] No bot with sufficient health factor for ${symbol} amount=${amount} after top-up; skipping`,
                    );
                    continue;
                }

                if (Math.random() < MARKET_ORDER_PROBABILITY) {
                    await this.ordersService.createBorrowMarketOrder(
                        { assetId, amount, marketIds },
                        account.wallet,
                        account.privyUserId,
                    );
                    this.logger.debug(`[BORROW MARKET] ${symbol} amount=${amount}`);
                } else {
                    const rate = this.randomRate(BORROW_RATE_MIN, BORROW_RATE_MAX);
                    await this.ordersService.createBorrowLimitOrder(
                        { assetId, amount, marketIds, rate },
                        account.wallet,
                        account.privyUserId,
                    );
                    this.logger.debug(`[BORROW LIMIT] ${symbol} amount=${amount} rate=${rate}bp`);
                }
            } catch (error) {
                const err = error as Error;
                this.logger.warn(
                    `[OrdersWorker] Failed borrow order for ${entry.symbol}: ${err.message}`,
                );
            }
        }
    }

    // ─── On-chain helpers ─────────────────────────────────────────────────

    private isNonceError(error: unknown): boolean {
        const msg = ((error as Error).message ?? "").toLowerCase();
        return (
            msg.includes("nonce too low") ||
            msg.includes("nonce too high") ||
            msg.includes("lower than the current nonce") ||
            msg.includes("higher than the next one expected")
        );
    }

    private async writeContractWithNonceRetry(
        privateKey: string,
        address: string,
        abi: readonly any[],
        functionName: string,
        args: any[],
    ): Promise<TransactionReceipt> {
        try {
            const receipt = await this.viemService.writeContract(
                this.chainId,
                privateKey,
                address,
                abi,
                functionName,
                args,
                { waitForReceipt: true },
            );
            return receipt as TransactionReceipt;
        } catch (e) {
            if (!this.isNonceError(e)) throw e;

            this.logger.warn(
                `Nonce error on ${functionName}; resetting wallet client and retrying`,
            );
            this.viemService.resetWalletClient(privateKey, this.chainId);
            await new Promise((r) => setTimeout(r, 2000));
            const receipt = await this.viemService.writeContract(
                this.chainId,
                privateKey,
                address,
                abi,
                functionName,
                args,
                { waitForReceipt: true },
            );
            return receipt as TransactionReceipt;
        }
    }

    // ─── Helpers ─────────────────────────────────────────────────────────

    /**
     * Returns a bot that has sufficient available balance for the given lend order,
     * or null if none qualify.
     */
    private async pickAccountWithSufficientBalanceForLend(
        assetId: string,
        quantityBaseUnits: string,
    ): Promise<BotAccount | null> {
        const candidates: BotAccount[] = [];
        for (const bot of this.botAccounts) {
            const account = await this.orderRepository.findAccountByWallet(bot.wallet);
            if (!account) continue;

            const portfolioBalanceRaw = await this.portfolioService.getAssetBalance(
                account.id,
                assetId,
            );
            const portfolioBalance = BigInt(portfolioBalanceRaw);

            const totalOpenOrders = await this.orderRepository.getTotalOpenQuantity(
                account.id,
                assetId,
                OrderSide.Lend,
            );

            const availableBalance = portfolioBalance - totalOpenOrders;

            if (BigInt(quantityBaseUnits) <= availableBalance) {
                candidates.push(bot);
            }
        }

        if (candidates.length === 0) return null;
        return candidates[Math.floor(Math.random() * candidates.length)];
    }

    /**
     * Returns a bot whose health factor remains >= 1 after placing the given borrow order,
     * or null if none qualify.
     */
    private async pickAccountWithSufficientHealthForBorrow(
        assetId: string,
        amount: string,
    ): Promise<BotAccount | null> {
        const assetPrice = await this.priceService.getPrice(assetId);
        if (assetPrice == null || assetPrice <= 0) return null;
        const newOrderUsd = Number(amount) * assetPrice;

        const candidates: BotAccount[] = [];
        for (const bot of this.botAccounts) {
            const account = await this.orderRepository.findAccountByWallet(bot.wallet);
            if (!account) continue;

            const hfResult = await this.portfolioService.getHealthFactorForAccount(account.id, {
                additionalBorrowUsd: newOrderUsd,
                includeOpenOrders: true,
            });

            this.logger.debug(
                `HF check bot=${bot.wallet.slice(0, 8)} account=${account.id} ` +
                `hf=${hfResult.healthFactor} collateralUsd=${hfResult.collateralUsd} ` +
                `debtUsd=${hfResult.debtUsd} weightedLtv=${hfResult.weightedLtvDecimal} ` +
                `additionalBorrowUsd=${newOrderUsd}`,
            );

            if (
                hfResult.healthFactor === HEALTH_FACTOR_NO_DEBT ||
                (Number.isFinite(hfResult.healthFactor) && hfResult.healthFactor >= 1)
            ) {
                candidates.push(bot);
            }
        }

        if (candidates.length === 0) return null;
        return candidates[Math.floor(Math.random() * candidates.length)];
    }

    private randomRate(min: number, max: number): number {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    private randomQuantity(min: number, max: number): string {
        return (min + Math.random() * (max - min)).toFixed(2);
    }

    private randomAccount() {
        return this.botAccounts[Math.floor(Math.random() * this.botAccounts.length)];
    }

    /**
     * Returns a bot not currently in topUpInProgress, or null if all are busy.
     */
    private pickAvailableBotForTopUp(keyPrefix: string = ""): BotAccount | null {
        const shuffled = [...this.botAccounts].sort(() => Math.random() - 0.5);
        for (const bot of shuffled) {
            const key = keyPrefix ? `${keyPrefix}-${bot.wallet}` : bot.wallet;
            if (!this.topUpInProgress.has(key)) return bot;
        }
        return null;
    }
}
