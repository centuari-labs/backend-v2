import {
    Injectable,
    BadRequestException,
    ConflictException,
    Logger,
    NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DataSource } from "typeorm";
import { PrivyClient } from "@privy-io/server-auth";
import {
    encodeFunctionData,
    parseUnits,
    formatUnits,
    decodeEventLog,
    type Hash,
} from "viem";
import { ViemService } from "../core/viem/viem.service";
import { TokensService } from "../tokens/tokens.service";
import { TokensRepository } from "../tokens/repositories/tokens.repository";
import { erc20Abi } from "../abis/ERC20";
import type {
    DepositResponseDto,
    DepositTokenDto,
    BalanceResponseDto,
} from "./dto/deposit.dto";

const TRANSFER_EVENT_ABI = [
    {
        type: "event" as const,
        name: "Transfer" as const,
        inputs: [
            {
                name: "from",
                type: "address" as const,
                indexed: true,
                internalType: "address" as const,
            },
            {
                name: "to",
                type: "address" as const,
                indexed: true,
                internalType: "address" as const,
            },
            {
                name: "value",
                type: "uint256" as const,
                indexed: false,
                internalType: "uint256" as const,
            },
        ],
    },
] as const;

@Injectable()
export class DepositService {
    private readonly logger = new Logger(DepositService.name);
    private readonly isDevMode: boolean;
    private readonly treasuryAddress: string | undefined;
    private readonly chainId: number;
    private readonly privyAppId: string;
    private readonly privyAppSecret: string;

    constructor(
        private readonly tokensService: TokensService,
        private readonly tokensRepository: TokensRepository,
        private readonly viemService: ViemService,
        private readonly configService: ConfigService,
        private readonly dataSource: DataSource,
    ) {
        this.isDevMode =
            this.configService.get<string>("NODE_ENV") !== "production";
        this.treasuryAddress =
            this.configService.get<string>("TREASURY_ADDRESS");
        this.chainId = Number(
            this.configService.get<string>("DEPOSIT_CHAIN_ID") ?? "421614",
        );
        this.privyAppId = this.configService.get<string>(
            "PRIVY_APP_ID",
        ) as string;
        this.privyAppSecret = this.configService.get<string>(
            "PRIVY_PROJECT_SECRET",
        ) as string;

        if (this.isDevMode) {
            this.logger.warn(
                "DEPOSIT running in DEV MODE -- returning mock responses",
            );
        }
    }

    async deposit(
        assetId: string,
        amount: string,
        walletAddress: string,
        bearerToken: string,
    ): Promise<DepositResponseDto> {
        const token = await this.tokensService.getTokenByAssetId(assetId);
        const decimals = token.decimals ?? 18;

        if (this.isDevMode) {
            this.logger.debug(
                `[DEV] Mock deposit: asset=${assetId}, amount=${amount}, wallet=${walletAddress}`,
            );
            return {
                transactionHash: `0x${"0".repeat(64)}`,
                status: "submitted",
            };
        }

        if (!this.treasuryAddress) {
            throw new BadRequestException(
                "Treasury address is not configured",
            );
        }

        const amountWei = parseUnits(amount, decimals);
        const calldata = encodeFunctionData({
            abi: erc20Abi,
            functionName: "transfer",
            args: [this.treasuryAddress as `0x${string}`, amountWei],
        });

        // Create an isolated PrivyClient per request to avoid race conditions
        // from updateAuthorizationKey() mutating shared state.
        const privyClient = new PrivyClient(
            this.privyAppId,
            this.privyAppSecret,
        );

        const { authorizationKey, wallets } =
            await privyClient.walletApi.generateUserSigner({
                userJwt: bearerToken,
            });

        const userWallet = wallets.find(
            (w) =>
                w.address.toLowerCase() === walletAddress.toLowerCase() &&
                w.chainType === "ethereum",
        );

        if (!userWallet) {
            throw new BadRequestException(
                "Could not find matching Privy embedded wallet",
            );
        }

        privyClient.walletApi.updateAuthorizationKey(authorizationKey);

        const result = await privyClient.walletApi.ethereum.sendTransaction({
            walletId: userWallet.id,
            address: userWallet.address,
            chainType: "ethereum",
            caip2: `eip155:${this.chainId}`,
            transaction: {
                to: token.tokenAddress as `0x${string}`,
                data: calldata,
                value: "0x0" as `0x${string}`,
            },
        });

        this.logger.log(
            `Deposit tx submitted: hash=${result.hash}, wallet=${walletAddress}, asset=${assetId}, amount=${amount}`,
        );

        return {
            transactionHash: result.hash,
            status: "submitted",
        };
    }

    async getBalance(
        assetId: string,
        walletAddress: string,
    ): Promise<BalanceResponseDto> {
        const token = await this.tokensService.getTokenByAssetId(assetId);
        const decimals = token.decimals ?? 18;

        if (this.isDevMode) {
            return {
                balance: parseUnits("1000", decimals).toString(),
                formattedBalance: "1000.00",
                decimals: token.decimals,
                symbol: token.symbol,
            };
        }

        const rawBalance = await this.viemService.readContract<bigint>(
            this.chainId,
            token.tokenAddress,
            erc20Abi,
            "balanceOf",
            [walletAddress],
        );

        const formatted = formatUnits(rawBalance, decimals);

        return {
            balance: rawBalance.toString(),
            formattedBalance: formatted,
            decimals: token.decimals,
            symbol: token.symbol,
        };
    }

    async getDepositTokens(): Promise<DepositTokenDto[]> {
        const tokens = await this.tokensRepository.findDepositTokens();
        return tokens.map((t) => ({
            id: t.id,
            symbol: t.symbol,
            name: t.name,
            tokenAddress: t.tokenAddress,
            decimals: t.decimals,
            imageUrl: t.imageUrl,
            chainId: t.chainId,
        }));
    }

    async verifyDeposit(
        txHash: string,
        assetId: string,
        amount: string,
        walletAddress: string,
    ): Promise<DepositResponseDto> {
        // 1. Check txHash not already credited
        const existing = await this.dataSource.query(
            `SELECT id FROM deposit_transactions WHERE tx_hash = $1`,
            [txHash],
        );
        if (existing.length > 0) {
            throw new ConflictException(
                "This transaction has already been processed",
            );
        }

        // 2. Get token info for verification
        const token = await this.tokensService.getTokenByAssetId(assetId);
        const decimals = token.decimals ?? 18;
        const expectedAmountWei = parseUnits(amount, decimals);

        if (!this.treasuryAddress) {
            throw new BadRequestException(
                "Treasury address is not configured",
            );
        }

        // 3. Fetch tx receipt from chain
        const receipt = await this.viemService.getTransactionReceipt(
            this.chainId,
            txHash as Hash,
        );

        // 4. Verify receipt status
        if (receipt.status !== "success") {
            throw new BadRequestException("Transaction reverted on-chain");
        }

        // 5. Find and verify the Transfer event in logs
        let verified = false;
        for (const log of receipt.logs) {
            try {
                const decoded = decodeEventLog({
                    abi: TRANSFER_EVENT_ABI,
                    data: log.data,
                    topics: log.topics,
                });

                const from = (decoded.args as any).from as string;
                const to = (decoded.args as any).to as string;
                const value = (decoded.args as any).value as bigint;
                const logAddress = log.address;

                const fromMatch =
                    from.toLowerCase() === walletAddress.toLowerCase();
                const toMatch =
                    to.toLowerCase() ===
                    this.treasuryAddress.toLowerCase();
                const tokenMatch =
                    logAddress.toLowerCase() ===
                    token.tokenAddress.toLowerCase();
                const amountMatch = value === expectedAmountWei;

                if (fromMatch && toMatch && tokenMatch && amountMatch) {
                    verified = true;
                    break;
                }
            } catch {
                // Not a Transfer event or decoding failed — skip
            }
        }

        if (!verified) {
            throw new BadRequestException(
                "Transaction does not contain a valid deposit transfer to the treasury",
            );
        }

        // 6. Look up user account
        const accountRows = await this.dataSource.query(
            `SELECT id FROM accounts WHERE LOWER(user_wallet) = LOWER($1)`,
            [walletAddress],
        );
        if (accountRows.length === 0) {
            throw new NotFoundException("Account not found for this wallet");
        }
        const accountId = accountRows[0].id;

        // 7. Atomically record the deposit and update portfolio
        await this.dataSource.transaction(async (manager) => {
            // Record deposit transaction (unique constraint on tx_hash prevents double-credit)
            await manager.query(
                `INSERT INTO deposit_transactions (tx_hash, asset_id, account_id, amount, from_address, token_address, chain_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [
                    txHash,
                    assetId,
                    accountId,
                    expectedAmountWei.toString(),
                    walletAddress,
                    token.tokenAddress,
                    this.chainId,
                ],
            );

            // Upsert portfolio: increment existing or create new
            const portfolioRows = await manager.query(
                `SELECT id, amount FROM portfolio WHERE account_id = $1 AND asset_id = $2`,
                [accountId, assetId],
            );

            if (portfolioRows.length > 0) {
                const currentAmount = BigInt(portfolioRows[0].amount);
                const newAmount = currentAmount + expectedAmountWei;
                await manager.query(
                    `UPDATE portfolio SET amount = $1, updated_at = NOW() WHERE id = $2`,
                    [newAmount.toString(), portfolioRows[0].id],
                );
            } else {
                await manager.query(
                    `INSERT INTO portfolio (asset_id, account_id, amount, is_collateral)
                     VALUES ($1, $2, $3, false)`,
                    [assetId, accountId, expectedAmountWei.toString()],
                );
            }
        });

        this.logger.log(
            `Deposit verified: txHash=${txHash}, wallet=${walletAddress}, asset=${assetId}, amount=${amount}`,
        );

        return {
            transactionHash: txHash,
            status: "confirmed",
        };
    }
}
