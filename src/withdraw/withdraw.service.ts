import {
    BadRequestException,
    Injectable,
    InternalServerErrorException,
    Logger,
    NotFoundException,
} from "@nestjs/common";
import { parseUnits } from "viem";
import type { TransactionReceipt } from "viem";
import { ViemService } from "../core/viem/viem.service";
import { ChainConfigService } from "../core/chain-config/chain-config.service";
import { TokensService } from "../tokens/tokens.service";
import { PortfolioRepository } from "../portfolio/repositories/portfolio.repository";
import { PortfolioService } from "../portfolio/portfolio.service";
import { OrderRepository } from "../orders/repositories/order.repository";
import { HEALTH_FACTOR_NO_DEBT } from "../portfolio/helpers/health-factor.helpers";
import { treasuryAbi } from "../../abis/treasury";
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
    ) {}

    async withdraw(
        dto: WithdrawRequestDto,
        walletAddress: string,
    ): Promise<WithdrawResponseDto> {
        const { assetId, amount } = dto;

        // Validate amount is positive
        const amountNum = Number(amount);
        if (Number.isNaN(amountNum) || amountNum <= 0) {
            throw new BadRequestException("Amount must be a positive number");
        }

        // Resolve account
        const account =
            await this.orderRepository.findAccountByWallet(walletAddress);
        if (!account) {
            throw new NotFoundException("Account not found");
        }

        // Resolve token
        const token = await this.tokensService.getTokenByAssetId(assetId);
        if (!token) {
            throw new NotFoundException("Token not found");
        }

        const decimals = token.decimals ?? 18;
        const amountInBaseStr = humanToBaseUnits(amount, decimals);
        const amountBaseNum = Number(amountInBaseStr);

        // Lock all portfolio rows for this account + asset (both collateral and non-collateral)
        const queryRunner =
            this.portfolioRepository.manager.connection.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            const portfolioRows = await queryRunner.query(
                `SELECT id, amount, locked_amount, is_collateral FROM portfolio
                 WHERE account_id = $1 AND asset_id = $2
                 FOR UPDATE`,
                [account.id, assetId],
            );

            if (!portfolioRows || portfolioRows.length === 0) {
                throw new BadRequestException(
                    "No balance found for this asset",
                );
            }

            // Separate collateral and non-collateral rows
            const nonCollateralRow = portfolioRows.find(
                (r: any) => !r.is_collateral,
            );
            const collateralRow = portfolioRows.find(
                (r: any) => r.is_collateral,
            );

            const nonCollateralAmount = nonCollateralRow
                ? Number(nonCollateralRow.amount)
                : 0;
            const collateralAmount = collateralRow
                ? Number(collateralRow.amount)
                : 0;
            const lockedAmount = nonCollateralRow
                ? Number(nonCollateralRow.locked_amount ?? 0)
                : 0;
            const totalAvailable =
                nonCollateralAmount + collateralAmount - lockedAmount;

            if (amountBaseNum > totalAvailable) {
                throw new BadRequestException(
                    `Insufficient balance. Available: ${totalAvailable}, Requested: ${amountNum}`,
                );
            }

            // Deduct from non-collateral first, then collateral
            const nonCollateralDeduction = Math.min(
                amountBaseNum,
                nonCollateralAmount,
            );
            const collateralDeduction = amountBaseNum - nonCollateralDeduction;

            // Health factor check when touching collateral
            if (collateralDeduction > 0) {
                const simulated =
                    await this.portfolioService.simulateHealthFactorAfterWithdrawal(
                        account.id,
                        assetId,
                        collateralDeduction.toString(),
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

            // Call Treasury.withdraw on-chain
            const amountInBaseUnits = parseUnits(amount, decimals);
            this.logger.log(
                `Executing withdraw: token=${token.tokenAddress}, to=${walletAddress}, amount=${amountInBaseUnits}`,
            );

            const receipt = (await this.viemService.writeContract(
                this.chainConfig.chainId,
                this.chainConfig.operatorPrivateKey,
                this.chainConfig.treasuryAddress,
                treasuryAbi,
                "withdraw",
                [token.tokenAddress, walletAddress, amountInBaseUnits],
                { waitForReceipt: true },
            )) as TransactionReceipt;

            // Deduct from non-collateral row
            if (nonCollateralDeduction > 0 && nonCollateralRow) {
                const newAmount = nonCollateralAmount - nonCollateralDeduction;
                if (newAmount <= 0) {
                    await queryRunner.query(
                        "DELETE FROM portfolio WHERE id = $1",
                        [nonCollateralRow.id],
                    );
                } else {
                    await queryRunner.query(
                        "UPDATE portfolio SET amount = $1, updated_at = NOW() WHERE id = $2",
                        [newAmount.toString(), nonCollateralRow.id],
                    );
                }
            }

            // Deduct from collateral row
            if (collateralDeduction > 0 && collateralRow) {
                const newAmount = collateralAmount - collateralDeduction;
                if (newAmount <= 0) {
                    await queryRunner.query(
                        "DELETE FROM portfolio WHERE id = $1",
                        [collateralRow.id],
                    );
                } else {
                    await queryRunner.query(
                        "UPDATE portfolio SET amount = $1, updated_at = NOW() WHERE id = $2",
                        [newAmount.toString(), collateralRow.id],
                    );
                }
            }

            await queryRunner.commitTransaction();

            this.logger.log(
                `Withdraw successful: txHash=${receipt.transactionHash}, amount=${amount} ${token.symbol}`,
            );

            return {
                txHash: receipt.transactionHash,
                status: "success",
            };
        } catch (error: any) {
            await queryRunner.rollbackTransaction();
            if (
                error instanceof BadRequestException ||
                error instanceof NotFoundException
            ) {
                throw error;
            }
            this.logger.error(
                `Withdraw contract call failed: ${error.message}`,
            );
            const parsed = parseContractError(error.message, {
                InsufficientFunds:
                    "Insufficient balance in Treasury to withdraw this amount.",
            });
            if (parsed.isKnown) {
                throw new BadRequestException(parsed.message);
            }
            throw new InternalServerErrorException(parsed.message);
        } finally {
            await queryRunner.release();
        }
    }
}
