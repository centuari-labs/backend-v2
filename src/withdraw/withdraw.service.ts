import {
    BadRequestException,
    Injectable,
    InternalServerErrorException,
    Logger,
    NotFoundException,
} from "@nestjs/common";
import { parseUnits, type Abi, type TransactionReceipt } from "viem";
import { ViemService } from "../core/viem/viem.service";
import { ChainConfigService } from "../core/chain-config/chain-config.service";
import { DatabaseService } from "../core/database/database.service";
import { TokensService } from "../tokens/tokens.service";
import { PortfolioRepository } from "../portfolio/repositories/portfolio.repository";
import { PortfolioService } from "../portfolio/portfolio.service";
import { OrderRepository } from "../orders/repositories/order.repository";
import { HEALTH_FACTOR_NO_DEBT } from "../portfolio/helpers/health-factor.helpers";
import HubDepositorAbiJson from "../abi/HubDepositor.json";
import WithdrawalRegistryAbiJson from "../abi/WithdrawalRegistry.json";

const HubDepositorAbi = HubDepositorAbiJson as Abi;
const WithdrawalRegistryAbi = WithdrawalRegistryAbiJson as Abi;
import { applyWithdrawEffects } from "../core/on-chain-state/apply-withdraw";
import { humanToBaseUnits } from "../common/utils/number.utils";
import { parseContractError } from "../common/utils/contract-errors.utils";
import type {
    WithdrawRequestDto,
    WithdrawResponseDto,
} from "./dto/withdraw.dto";

@Injectable()
export class WithdrawService {
    private readonly logger = new Logger(WithdrawService.name);

    constructor(
        private readonly viemService: ViemService,
        private readonly tokensService: TokensService,
        private readonly portfolioRepository: PortfolioRepository,
        private readonly portfolioService: PortfolioService,
        private readonly orderRepository: OrderRepository,
        private readonly chainConfig: ChainConfigService,
        private readonly databaseService: DatabaseService,
    ) {}

    async withdraw(
        dto: WithdrawRequestDto,
        walletAddress: string,
    ): Promise<WithdrawResponseDto> {
        const { assetId, amount } = dto;

        const amountNum = Number(amount);
        if (Number.isNaN(amountNum) || amountNum <= 0) {
            throw new BadRequestException("Amount must be a positive number");
        }

        const account =
            await this.orderRepository.findAccountByWallet(walletAddress);
        if (!account) {
            throw new NotFoundException("Account not found");
        }

        const token = await this.tokensService.getTokenByAssetId(assetId);
        if (!token) {
            throw new NotFoundException("Token not found");
        }

        const decimals = token.decimals ?? 18;
        const amountInBaseStr = humanToBaseUnits(amount, decimals);
        const amountInBaseUnits = BigInt(amountInBaseStr);

        const balance = await this.portfolioRepository.getUserBalanceForAsset(
            walletAddress,
            assetId,
        );
        const available = balance ? BigInt(balance.available) : 0n;
        if (!balance || available <= 0n) {
            throw new BadRequestException("No balance found for this asset");
        }

        if (amountInBaseUnits > available) {
            throw new BadRequestException(
                `Insufficient balance. Available: ${available.toString()}, Requested: ${amountInBaseStr}`,
            );
        }

        if (balance.isCollateral) {
            const simulated =
                await this.portfolioService.simulateHealthFactorAfterWithdrawal(
                    account.id,
                    assetId,
                    amountInBaseUnits.toString(),
                );

            if (
                simulated.healthFactor !== HEALTH_FACTOR_NO_DEBT &&
                simulated.healthFactor <= 1.0
            ) {
                throw new BadRequestException(
                    `Withdrawal would reduce health factor below 1.0 (projected: ${simulated.healthFactor.toFixed(4)})`,
                );
            }
        }

        this.logger.log(
            `Executing payout: user=${walletAddress}, asset=${token.tokenAddress}, amount=${amountInBaseUnits}`,
        );

        const receipt = await this.executeBlockchainPayout(
            walletAddress,
            token.tokenAddress,
            amountInBaseUnits,
        );

        try {
            await applyWithdrawEffects({
                pool: this.databaseService.getPool(),
                client: this.viemService.getPublicClient(
                    this.chainConfig.chainId,
                ),
                receipt,
                expectedUser: walletAddress as `0x${string}`,
            });
            this.logger.log(
                `Withdraw applied to shared schema for tx ${receipt.transactionHash}`,
            );
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            this.logger.error(
                `CRITICAL: withdraw on-chain success (${receipt.transactionHash}) but applyOnChainEffect failed: ${msg}`,
            );
            throw new InternalServerErrorException(
                "Withdraw finalized on-chain but failed local state update.",
            );
        }

        this.logger.log(
            `Withdraw successful: txHash=${receipt.transactionHash}, amount=${amount} ${token.symbol}`,
        );

        return {
            txHash: receipt.transactionHash,
            status: "success",
        };
    }

    private async executeBlockchainPayout(
        user: string,
        token: string,
        amount: bigint,
    ): Promise<TransactionReceipt> {
        try {
            if (this.chainConfig.withdrawViaRegistry) {
                return (await this.viemService.writeContract(
                    this.chainConfig.chainId,
                    this.chainConfig.operatorPrivateKey,
                    this.chainConfig.withdrawalRegistryAddress,
                    WithdrawalRegistryAbi,
                    "requestWithdrawalFor",
                    [user, token, amount, this.chainConfig.chainId],
                    { waitForReceipt: true },
                )) as TransactionReceipt;
            }

            return (await this.viemService.writeContract(
                this.chainConfig.chainId,
                this.chainConfig.operatorPrivateKey,
                this.chainConfig.hubDepositorAddress,
                HubDepositorAbi,
                "payout",
                [user, token, amount],
                { waitForReceipt: true },
            )) as TransactionReceipt;
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            this.logger.error(`Contract call failed: ${msg}`);
            const parsed = parseContractError(msg, {
                InsufficientFunds: "Insufficient balance for withdrawal.",
                WithdrawalBlockedByHF:
                    "Withdrawal blocked: it would reduce your health factor below the safe threshold.",
                InsufficientChainLiquidity:
                    "Insufficient liquidity on this chain to fulfill the withdrawal right now.",
            });
            if (parsed.isKnown) {
                throw new BadRequestException(parsed.message);
            }
            throw new InternalServerErrorException(parsed.message);
        }
    }
}
