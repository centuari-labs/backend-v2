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

const LEND_INSERT_INTERVAL_MS = 15000;
const BORROW_INSERT_INTERVAL_MS = 15000;
const CACHE_REFRESH_INTERVAL_MS = 60000;
const FUNDING_INTERVAL_MS = 5 * 60 * 1000;

const LEND_RATE_MIN = 600;
const LEND_RATE_MAX = 1500;
const BORROW_RATE_MIN = 200;
const BORROW_RATE_MAX = 800;
const LEND_QUANTITY_MIN = 500;
const LEND_QUANTITY_MAX = 10000;
const BORROW_QUANTITY_MIN = 100;
const BORROW_QUANTITY_MAX = 5000;
const MARKET_ORDER_PROBABILITY = 0.05;

const NUM_BOT_ACCOUNTS = 6;
const MIN_TREASURY_BALANCE_HUMAN = 50_000;
const MIN_COLLATERAL_BALANCE_HUMAN = 1; // For BTC/ETH etc. - 1 unit to provide USD-value collateral
const MIN_GAS_BALANCE_WEI = BigInt(1e15); // ~0.001 ETH

interface BotAccount {
    privateKey: string;
    wallet: string;
    privyUserId: string;
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
    ) {}

    async onModuleInit(): Promise<void> {
        if (!this.isEnabled) {
            this.logger.log(
                "OrdersWorker is disabled (NODE_ENV or ORDER_WORKER_ENABLED).",
            );
            return;
        }
        this.logger.log("OrdersWorker enabled — initializing bot accounts and cache.");

        this.chainId = Number(this.configService.get<string>("DEPOSIT_CHAIN_ID") ?? "421614");
        this.treasuryAddress =
            this.configService.get<string>("TREASURY_ADDRESS") ??
            (() => {
                throw new Error("TREASURY_ADDRESS is not configured");
            })();

        this.botAccounts = this.deriveBotAccounts();
        await this.ensureAccountsExist();
        await this.refreshAssetMarketCache();
        await this.ensureFunding();
    }

    private get isEnabled(): boolean {
        if (process.env.NODE_ENV === "production") return false;
        return process.env.ORDER_WORKER_ENABLED === "true";
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

    @Interval(FUNDING_INTERVAL_MS)
    private async ensureFunding(): Promise<void> {
        if (!this.isEnabled || this.assetMarketCache.length === 0) return;

        const operatorKey = this.configService.get<string>("OPERATOR_PRIVATE_KEY");
        if (!operatorKey) {
            this.logger.error("OPERATOR_PRIVATE_KEY is not configured; cannot fund bots");
            return;
        }
        const formattedKey = operatorKey.startsWith("0x") ? operatorKey : `0x${operatorKey}`;

        // Pick loan tokens from current cache
        const assetIds = Array.from(new Set(this.assetMarketCache.map((e) => e.assetId)));
        const tokens = await this.tokenRepository.find({
            where: { id: In(assetIds) },
        });
        const tokenById = new Map(tokens.map((t) => [t.id, t]));

        for (const bot of this.botAccounts) {
            try {
                // 1. Gas funding
                await this.ensureGasForBot(formattedKey, bot.wallet);

                // 2. Loan token funding (isolated per token so one failure doesn't block others)
                for (const assetId of assetIds) {
                    const token = tokenById.get(assetId);
                    if (!token?.tokenAddress || token.decimals == null) continue;

                    try {
                        await this.ensureTokenFundingForBot(
                            formattedKey,
                            bot,
                            token.id,
                            token.tokenAddress,
                            token.decimals,
                        );
                    } catch (tokenErr) {
                        this.logger.warn(
                            `Funding token ${token.symbol ?? token.tokenAddress} for bot ${bot.wallet} failed: ${(tokenErr as Error).message?.slice(0, 120)}`,
                        );
                    }
                }

                // 3. Collateral token funding (BTC, ETH, etc.) for borrow health factor
                const collateralTokens = await this.tokenRepository.find({
                    where: {
                        isLoanToken: false,
                        chainId: this.chainId as unknown as number,
                    },
                });
                for (const token of collateralTokens) {
                    if (!token.tokenAddress || token.decimals == null) continue;

                    try {
                        await this.ensureTokenFundingForBot(
                            formattedKey,
                            bot,
                            token.id,
                            token.tokenAddress,
                            token.decimals,
                            MIN_COLLATERAL_BALANCE_HUMAN,
                        );
                    } catch (tokenErr) {
                        this.logger.warn(
                            `Funding collateral ${token.symbol ?? token.tokenAddress} for bot ${bot.wallet} failed: ${(tokenErr as Error).message?.slice(0, 120)}`,
                        );
                    }
                }
            } catch (e) {
                this.logger.error(
                    `Failed to ensure funding for bot ${bot.wallet}: ${(e as Error).message}`,
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
            await walletClient.sendTransaction({
                account: operatorAccount,
                to: botAddress as `0x${string}`,
                value: MIN_GAS_BALANCE_WEI,
            });
            this.logger.log(`Sent gas to bot ${botAddress}`);
        } catch (e) {
            this.logger.error(
                `Failed to fund gas for bot ${botAddress}: ${(e as Error).message}`,
            );
        }
    }

    private async ensureTokenFundingForBot(
        operatorKey: string,
        bot: BotAccount,
        assetId: string,
        tokenAddress: string,
        decimals: number,
        minBalanceHuman: number = MIN_TREASURY_BALANCE_HUMAN,
    ): Promise<void> {
        // Skip tokens that Treasury does not support
        const isSupported = await this.viemService.readContract<boolean>(
            this.chainId,
            this.treasuryAddress,
            treasuryAbi,
            "supportedToken",
            [tokenAddress],
        );
        if (!isSupported) {
            this.logger.debug(
                `Token ${tokenAddress} is not supported by Treasury; skipping funding for bot ${bot.wallet}`,
            );
            return;
        }

        const minBalanceBaseUnits =
            BigInt(minBalanceHuman) * 10n ** BigInt(decimals);

        let currentTreasuryBalance = await this.viemService.readContract<bigint>(
            this.chainId,
            this.treasuryAddress,
            treasuryAbi,
            "balanceOf",
            [bot.wallet, tokenAddress],
        );
        if (currentTreasuryBalance >= minBalanceBaseUnits) {
            this.logger.debug(
                `Treasury balance already sufficient for bot ${bot.wallet} token ${tokenAddress}`,
            );
            await this.syncPortfolioFromOnChainBalance(bot, assetId, tokenAddress);
            return;
        }

        const shortfall = minBalanceBaseUnits - currentTreasuryBalance;

        // Mint to bot via Faucet (operator mints to bot)
        await this.faucetService.requestTokens(this.chainId, bot.wallet, tokenAddress);

        // Check actual wallet balance after mint
        const walletBalance = await this.viemService.readContract<bigint>(
            this.chainId,
            tokenAddress,
            erc20Abi,
            "balanceOf",
            [bot.wallet],
        );
        if (walletBalance === 0n) {
            this.logger.warn(
                `Bot ${bot.wallet} has zero ${tokenAddress} balance after faucet mint; skipping deposit`,
            );
            return;
        }

        const depositAmount = walletBalance < shortfall ? walletBalance : shortfall;
        if (depositAmount === 0n) {
            return;
        }

        // Ensure allowance
        const allowance = await this.viemService.readContract<bigint>(
            this.chainId,
            tokenAddress,
            erc20Abi,
            "allowance",
            [bot.wallet, this.treasuryAddress],
        );
        if (allowance < depositAmount) {
            await this.writeContractWithNonceRetry(
                bot.privateKey,
                tokenAddress,
                erc20Abi,
                "approve",
                [this.treasuryAddress, BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")],
            );
            // Allow RPC to reflect the updated nonce before the next tx
            await new Promise((r) => setTimeout(r, 3000));
        }

        const receipt = await this.writeContractWithNonceRetry(
            bot.privateKey,
            this.treasuryAddress,
            treasuryAbi,
            "deposit",
            [tokenAddress, depositAmount],
        );

        // Parse Deposited event from receipt and upsert portfolio immediately
        try {
            const depositedLogs = parseEventLogs({
                abi: treasuryAbi,
                eventName: "Deposited",
                logs: receipt.logs,
            }).filter((log) => log.address?.toLowerCase() === this.treasuryAddress.toLowerCase());

            const account = await this.orderRepository.findAccountByWallet(bot.wallet);
            this.logger.debug(
                `Portfolio upsert from events: depositedLogs=${depositedLogs.length}, accountFound=${!!account}`,
            );
            if (account) {
                for (const log of depositedLogs) {
                    const userWallet = (log.args as { user: string }).user.toLowerCase();
                    const tokenAddr = (log.args as { token: string }).token.toLowerCase();
                    const amount = (log.args as { amount: bigint }).amount.toString();
                    this.logger.debug(`Upserting portfolio from Deposited event: amount=${amount}`);
                    const portfolioId = portfolioUuidFor(userWallet, tokenAddr);
                    await this.portfolioRepository.upsertPortfolio(
                        portfolioId,
                        account.id,
                        assetId,
                        amount,
                    );
                }
            }
        } catch (e) {
            this.logger.error(
                `Failed to upsert portfolio after deposit for bot ${bot.wallet}: ${(e as Error).message}`,
            );
        }

        // Always sync portfolio from on-chain balance (event parsing may have been skipped)
        await this.syncPortfolioFromOnChainBalance(bot, assetId, tokenAddress);

        this.logger.log(
            `Ensured treasury balance for bot ${bot.wallet} token ${tokenAddress} up to ${MIN_TREASURY_BALANCE_HUMAN}`,
        );

        // Mark asset as collateral to support borrow health factor, if not already
        try {
            const asset = await this.tokenRepository.findOne({
                where: { tokenAddress },
            });
            if (asset?.id) {
                await this.portfolioService.setAssetAsCollateral(bot.wallet, {
                    assetIds: [asset.id],
                    isCollateral: true,
                });
            }
        } catch (e) {
            this.logger.error(
                `Failed to mark asset ${tokenAddress} as collateral for bot ${bot.wallet}: ${(e as Error).message}`,
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
        if (!this.isEnabled || this.assetMarketCache.length === 0) return;

        for (const entry of this.assetMarketCache) {
            try {
                const { assetId, marketIds, symbol } = entry;
                const amount = this.randomQuantity(LEND_QUANTITY_MIN, LEND_QUANTITY_MAX);
                const account = this.randomAccount();

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
                this.logger.error(
                    `Failed to insert lend order for ${entry.symbol}: ${(error as Error).message}`,
                );
            }
        }
    }

    // ─── Create BORROW orders (one per loan token per interval) ───────

    @Interval(BORROW_INSERT_INTERVAL_MS)
    async createBorrowOrders(): Promise<void> {
        if (!this.isEnabled || this.assetMarketCache.length === 0) return;

        for (const entry of this.assetMarketCache) {
            try {
                const { assetId, marketIds, symbol } = entry;
                const amount = this.randomQuantity(BORROW_QUANTITY_MIN, BORROW_QUANTITY_MAX);
                const account = this.randomAccount();

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
                this.logger.error(
                    `Failed to insert borrow order for ${entry.symbol}: ${(error as Error).message}`,
                );
            }
        }
    }

    // ─── On-chain helpers ─────────────────────────────────────────────────

    private isNonceError(error: unknown): boolean {
        const msg = ((error as Error).message ?? "").toLowerCase();
        return msg.includes("nonce too low") || msg.includes("lower than the current nonce");
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
                `Nonce error on ${functionName}; retrying once after short delay`,
            );
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

    private randomRate(min: number, max: number): number {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    private randomQuantity(min: number, max: number): string {
        return (min + Math.random() * (max - min)).toFixed(2);
    }

    private randomAccount() {
        return this.botAccounts[Math.floor(Math.random() * this.botAccounts.length)];
    }
}
