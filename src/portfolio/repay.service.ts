import {
    BadRequestException,
    Injectable,
    InternalServerErrorException,
    Logger,
    NotFoundException,
} from "@nestjs/common";
import { parseUnits } from "viem";
import type { TransactionReceipt } from "viem";
import { centuariAbi } from "../../abis/centuari";
import { ChainConfigService } from "../core/chain-config/chain-config.service";
import { DatabaseService } from "../core/database/database.service";
import { applyRepayEffects } from "../core/on-chain-state/apply-repay";
import { ViemService } from "../core/viem/viem.service";
import { parseContractError } from "../common/utils/contract-errors.utils";
import { uuidToBytes32 } from "../common/utils/uuid.utils";
import { PortfolioRepository } from "./repositories/portfolio.repository";
import { RepayRepository } from "./repositories/repay.repository";
import { RepayRequestDto, RepayResponseDto } from "./dto/repay.dto";

@Injectable()
export class RepayService {
    private readonly logger = new Logger(RepayService.name);

    constructor(
        private readonly viemService: ViemService,
        private readonly repayRepository: RepayRepository,
        private readonly portfolioRepository: PortfolioRepository,
        private readonly chainConfig: ChainConfigService,
        private readonly databaseService: DatabaseService,
    ) {}

    async repay(
        dto: RepayRequestDto,
        walletAddress: string,
        _privyUserId: string,
    ): Promise<RepayResponseDto> {
        const { marketId, amount } = dto;

        const market = await this.repayRepository.getMarketWithAsset(marketId);
        if (!market) throw new NotFoundException("Market not found");

        // Convert backend UUID → bytes32 for on-chain + shared-schema lookup.
        const marketIdBytes32 = uuidToBytes32(marketId);

        const position = await this.portfolioRepository.getBorrowPosition(
            marketIdBytes32,
            walletAddress,
        );
        const totalDebt = position ? BigInt(position.debt) : 0n;
        if (totalDebt <= 0n) {
            throw new NotFoundException("No active borrow positions found");
        }

        const repayAmountBaseUnits = this.parseRepayAmount(
            amount,
            market.decimals ?? 18,
            totalDebt,
        );

        this.logger.log(
            `Repay diagnostics: marketId=${marketId}, marketIdBytes32=${marketIdBytes32}, ` +
                `token=${market.tokenAddress}, borrower=${walletAddress}, ` +
                `amount=${repayAmountBaseUnits}, totalDebt=${totalDebt}, decimals=${market.decimals}`,
        );

        const receipt = await this.executeBlockchainRepay(
            marketIdBytes32,
            walletAddress,
            market.tokenAddress,
            repayAmountBaseUnits,
        );

        try {
            await applyRepayEffects({
                pool: this.databaseService.getPool(),
                client: this.viemService.getPublicClient(
                    this.chainConfig.chainId,
                ),
                receipt,
                expectedBorrower: walletAddress as `0x${string}`,
            });
            this.logger.log(
                `Repay applied to shared schema for tx ${receipt.transactionHash}`,
            );
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            this.logger.error(
                `CRITICAL: repay on-chain success (${receipt.transactionHash}) but applyOnChainEffect failed: ${msg}`,
            );
            throw new InternalServerErrorException(
                "Repay finalized on-chain but failed local state update.",
            );
        }

        return { txHash: receipt.transactionHash, status: "success" };
    }

    private parseRepayAmount(
        amount: string,
        decimals: number,
        totalDebt: bigint,
    ): bigint {
        const amountNum = Number(amount);
        if (Number.isNaN(amountNum) || amountNum <= 0) {
            throw new BadRequestException("Invalid repay amount");
        }

        try {
            const baseUnits = parseUnits(amount, decimals);
            if (baseUnits > totalDebt) {
                throw new BadRequestException(
                    `Repay amount (${amount}) exceeds total debt`,
                );
            }
            if (baseUnits <= 0n) {
                throw new BadRequestException(
                    "Repay amount must be greater than zero",
                );
            }
            return baseUnits;
        } catch (error) {
            if (error instanceof BadRequestException) throw error;
            throw new BadRequestException(
                "Invalid amount format for this token",
            );
        }
    }

    private async executeBlockchainRepay(
        marketId: `0x${string}`,
        borrower: string,
        token: string,
        amount: bigint,
    ): Promise<TransactionReceipt> {
        try {
            const receipt = (await this.viemService.writeContract(
                this.chainConfig.chainId,
                this.chainConfig.operatorPrivateKey,
                this.chainConfig.centuariAddress,
                centuariAbi,
                "repay",
                [marketId, borrower, token, amount],
                { waitForReceipt: true },
            )) as TransactionReceipt;
            return receipt;
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            this.logger.error(`Contract call failed: ${msg}`);
            const parsed = parseContractError(msg, {
                InsufficientFunds:
                    "Insufficient balance in Treasury. Please deposit tokens before repaying.",
            });
            if (parsed.isKnown) {
                throw new BadRequestException(parsed.message);
            }
            throw new InternalServerErrorException(parsed.message);
        }
    }
}
