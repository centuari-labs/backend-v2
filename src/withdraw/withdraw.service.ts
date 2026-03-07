import {
    BadRequestException,
    Injectable,
    Logger,
    NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { parseUnits } from "viem";
import type { TransactionReceipt } from "viem";
import { ViemService } from "../core/viem/viem.service";
import { TokensService } from "../tokens/tokens.service";
import { PortfolioRepository } from "../portfolio/repositories/portfolio.repository";
import { OrderRepository } from "../orders/repositories/order.repository";
import { treasuryAbi } from "../../abis/treasury";
import type { WithdrawRequestDto, WithdrawResponseDto } from "./dto/withdraw.dto";

@Injectable()
export class WithdrawService {
    private readonly logger = new Logger(WithdrawService.name);
    private readonly chainId: number;
    private readonly operatorPrivateKey: string;
    private readonly treasuryAddress: string;

    constructor(
        private readonly viemService: ViemService,
        private readonly tokensService: TokensService,
        private readonly portfolioRepository: PortfolioRepository,
        private readonly orderRepository: OrderRepository,
        private readonly configService: ConfigService,
    ) {
        this.chainId = Number(
            this.configService.get<string>("DEPOSIT_CHAIN_ID") ?? "421614",
        );
        this.operatorPrivateKey =
            this.configService.get<string>("OPERATOR_PRIVATE_KEY") ?? "";
        this.treasuryAddress =
            this.configService.get<string>("TREASURY_ADDRESS") ?? "";
    }

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

        // Check non-collateral balance using a transaction with row lock
        const queryRunner =
            this.portfolioRepository.manager.connection.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            // Lock the portfolio row for this account + asset where isCollateral = false
            const portfolioRow = await queryRunner.query(
                `SELECT id, amount FROM portfolio
                 WHERE account_id = $1 AND asset_id = $2 AND is_collateral = false
                 FOR UPDATE`,
                [account.id, assetId],
            );

            if (!portfolioRow || portfolioRow.length === 0) {
                throw new BadRequestException(
                    "No withdrawable (non-collateral) balance found for this asset",
                );
            }

            const availableAmount = Number(portfolioRow[0].amount);
            const amountInBaseUnits = parseUnits(amount, decimals);

            if (amountNum > availableAmount) {
                throw new BadRequestException(
                    `Insufficient non-collateral balance. Available: ${availableAmount}, Requested: ${amountNum}`,
                );
            }

            // Call Treasury.withdraw on-chain
            this.logger.log(
                `Executing withdraw: token=${token.tokenAddress}, to=${walletAddress}, amount=${amountInBaseUnits}`,
            );

            const receipt = (await this.viemService.writeContract(
                this.chainId,
                this.operatorPrivateKey,
                this.treasuryAddress,
                treasuryAbi,
                "withdraw",
                [token.tokenAddress, walletAddress, amountInBaseUnits],
                { waitForReceipt: true },
            )) as TransactionReceipt;

            // Deduct from portfolio
            const newAmount = availableAmount - amountNum;
            if (newAmount <= 0) {
                await queryRunner.query(
                    `DELETE FROM portfolio WHERE id = $1`,
                    [portfolioRow[0].id],
                );
            } else {
                await queryRunner.query(
                    `UPDATE portfolio SET amount = $1, updated_at = NOW() WHERE id = $2`,
                    [newAmount.toString(), portfolioRow[0].id],
                );
            }

            await queryRunner.commitTransaction();

            this.logger.log(
                `Withdraw successful: txHash=${receipt.transactionHash}, amount=${amount} ${token.symbol}`,
            );

            return {
                txHash: receipt.transactionHash,
                status: "success",
            };
        } catch (error) {
            await queryRunner.rollbackTransaction();
            throw error;
        } finally {
            await queryRunner.release();
        }
    }
}
