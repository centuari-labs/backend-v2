import {
    Injectable,
    Logger,
    BadRequestException,
    NotFoundException,
    InternalServerErrorException,
} from "@nestjs/common";
import { DataSource } from "typeorm";
import { OrderRepository } from "../orders/repositories/order.repository";
import { ViemService } from "../core/viem/viem.service";
import { TokensService } from "../tokens/tokens.service";
import { MarketRepositories } from "../market/repository/market.repository";
import { ConfigService } from "@nestjs/config";
import { RepayRepository } from "./repositories/repay.repository";
import { RepayRequestDto, RepayResponseDto } from "./dto/repay.dto";
import { parseUnits } from "viem";
import type { TransactionReceipt } from "viem";
import { centuariAbi } from "../../abis/centuari";
import { uuidToBytes32, portfolioUuidFor } from "../common/utils/uuid.utils";
import { PortfolioRepository } from "./repositories/portfolio.repository";

@Injectable()
export class RepayService {
    private readonly logger = new Logger(RepayService.name);
    private readonly chainId: number;
    private readonly operatorPrivateKey: string;
    private readonly centuariAddress: string;

    constructor(
        private readonly viemService: ViemService,
        private readonly orderRepository: OrderRepository,
        private readonly repayRepository: RepayRepository,
        private readonly portfolioRepository: PortfolioRepository,
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

    async repay(
        dto: RepayRequestDto,
        walletAddress: string,
        privyUserId: string,
    ): Promise<RepayResponseDto> {
        const { positionId, amount } = dto;

        const accountId = await this.orderRepository
            .getOrCreateAccount(walletAddress, privyUserId)
            .then((a) => a.id);

        const position =
            await this.repayRepository.getBorrowPositionById(
                positionId,
                accountId,
            );
        if (!position) {
            throw new NotFoundException("Borrow position not found");
        }

        const market = await this.repayRepository.getMarketWithAsset(
            position.marketId,
        );
        if (!market) throw new NotFoundException("Market not found");

        const positionDebt = BigInt(position.debt);
        const repayAmountBaseUnits = this.parseRepayAmount(
            amount,
            market.decimals ?? 18,
            positionDebt,
        );

        const maturityDate = market.maturity ? new Date(market.maturity) : null;
        const maturityUnix = maturityDate
            ? Math.floor(maturityDate.getTime() / 1000)
            : 0;

        // Convert DB market UUID to on-chain bytes32 (matches settlement engine encoding)
        const marketIdBytes32 = uuidToBytes32(position.marketId);

        this.logger.log(
            `Repay diagnostics: marketId=${position.marketId}, marketIdBytes32=${marketIdBytes32}, ` +
                `token=${market.tokenAddress}, borrower=${walletAddress}, ` +
                `amount=${repayAmountBaseUnits}, positionDebt=${positionDebt}, decimals=${market.decimals}`,
        );

        // Pre-check: verify on-chain debt exists before attempting repay
        const onChainDebt = await this.getOnChainDebt(
            marketIdBytes32,
            walletAddress,
        );
        this.logger.log(
            `On-chain debt check: onChainDebt=${onChainDebt}, dbDebt=${positionDebt}`,
        );
        if (onChainDebt === 0n) {
            // On-chain debt is 0 but DB has debt — a previous repay succeeded
            // on-chain but the DB wasn't updated. Sync the DB now.
            if (positionDebt > 0n) {
                this.logger.warn(
                    `On-chain debt is 0 but DB debt is ${positionDebt}. Syncing DB to match on-chain state.`,
                );
                await this.updateDatabaseState(
                    positionId,
                    positionDebt,
                    "sync-from-chain",
                    accountId,
                    walletAddress,
                    market.assetId,
                    market.tokenAddress,
                );
            }
            throw new BadRequestException(
                "This position has already been fully repaid.",
            );
        }

        const txHash = await this.executeBlockchainRepay(
            marketIdBytes32,
            walletAddress,
            market.tokenAddress,
            repayAmountBaseUnits,
        );

        await this.updateDatabaseState(
            positionId,
            repayAmountBaseUnits,
            txHash,
            accountId,
            walletAddress,
            market.assetId,
            market.tokenAddress,
        );

        return { txHash, status: "success" };
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
    ): Promise<string> {
        try {
            const receipt = (await this.viemService.writeContract(
                this.chainId,
                this.operatorPrivateKey,
                this.centuariAddress,
                centuariAbi,
                "repay",
                [marketId, borrower, token, amount],
                { waitForReceipt: true },
            )) as TransactionReceipt;
            return receipt.transactionHash;
        } catch (error: any) {
            this.logger.error(`Contract call failed: ${error.message}`);
            if (error.message.includes("InvalidAmount")) {
                throw new BadRequestException(
                    "Contract reverted: InvalidAmount. Check maturity and amount.",
                );
            }
            throw new InternalServerErrorException(
                `Blockchain transaction failed: ${error.message}`,
            );
        }
    }

    private async getOnChainDebt(
        marketId: `0x${string}`,
        borrower: string,
    ): Promise<bigint> {
        const debt = await this.viemService.readContract<bigint>(
            this.chainId,
            this.centuariAddress,
            centuariAbi,
            "getBorrowPosition",
            [marketId, borrower],
        );
        return debt;
    }

    private async updateDatabaseState(
        positionId: string,
        repayAmount: bigint,
        txHash: string,
        accountId: string,
        walletAddress: string,
        assetId: string,
        tokenAddress: string,
    ): Promise<void> {
        try {
            await this.dataSource.transaction(async (manager) => {
                const position =
                    await this.repayRepository.getBorrowPositionById(
                        positionId,
                        accountId,
                        manager,
                    );
                if (!position) {
                    throw new NotFoundException("Borrow position not found");
                }

                const debt = BigInt(position.debt);
                const newDebt = debt - repayAmount;

                await this.repayRepository.updateBorrowPositionDebt(
                    manager,
                    positionId,
                    newDebt.toString(),
                );
            });

            // Deduct repay amount from portfolio balance (mirrors on-chain Treasury.repay)
            const portfolioId = portfolioUuidFor(
                walletAddress.toLowerCase(),
                tokenAddress.toLowerCase(),
            );
            await this.portfolioRepository.upsertPortfolio(
                portfolioId,
                accountId,
                assetId,
                (-repayAmount).toString(),
            );

            this.logger.log(
                `Repay DB state updated for tx: ${txHash}, portfolio deducted: ${repayAmount}`,
            );
        } catch (error: any) {
            this.logger.error(
                `CRITICAL: Blockchain tx succeeded (${txHash}) but DB update failed: ${error.message}`,
            );
            throw new InternalServerErrorException(
                "Repay finalized on-chain but failed local state update.",
            );
        }
    }
}
