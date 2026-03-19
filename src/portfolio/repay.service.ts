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
        const { marketId, amount } = dto;

        const accountId = await this.orderRepository
            .getOrCreateAccount(walletAddress, privyUserId)
            .then((a) => a.id);

        const market = await this.repayRepository.getMarketWithAsset(marketId);
        if (!market) throw new NotFoundException("Market not found");

        const totalDebtStr = await this.repayRepository.getUserTotalDebt(
            accountId,
            marketId,
        );
        const totalDebtBaseUnits = BigInt(totalDebtStr);
        const repayAmountBaseUnits = this.parseRepayAmount(
            amount,
            market.decimals ?? 18,
            totalDebtBaseUnits,
        );

        const positions = await this.repayRepository.getBorrowPositions(
            accountId,
            marketId,
        );
        if (!positions || positions.length === 0) {
            throw new BadRequestException("No active borrow positions found");
        }

        const maturityDate = market.maturity ? new Date(market.maturity) : null;
        const maturityUnix = maturityDate
            ? Math.floor(maturityDate.getTime() / 1000)
            : 0;

        this.logger.log(
            `Executing repay: token=${market.tokenAddress}, user=${walletAddress}, amount=${repayAmountBaseUnits}, maturity=${maturityUnix}`,
        );

        const txHash = await this.executeBlockchainRepay(
            walletAddress,
            market.tokenAddress,
            BigInt(maturityUnix),
            repayAmountBaseUnits,
        );

        await this.updateDatabaseState(
            positions,
            repayAmountBaseUnits,
            txHash,
            accountId,
            marketId,
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
        borrower: string,
        token: string,
        maturity: bigint,
        amount: bigint,
    ): Promise<string> {
        try {
            const receipt = (await this.viemService.writeContract(
                this.chainId,
                this.operatorPrivateKey,
                this.centuariAddress,
                centuariAbi,
                "repay",
                [borrower, token, maturity, amount],
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

    private async updateDatabaseState(
        positions: any[],
        repayAmount: bigint,
        txHash: string,
        accountId: string,
        marketId: string,
    ): Promise<void> {
        try {
            await this.dataSource.transaction(async (manager) => {
                const targetPositions =
                    await this.repayRepository.getBorrowPositions(
                        accountId,
                        marketId,
                        manager,
                    );

                let remaining = repayAmount;
                for (const pos of targetPositions) {
                    if (remaining <= 0n) break;

                    const debt = BigInt(pos.debt);
                    const toRepay = remaining >= debt ? debt : remaining;
                    const newDebt = debt - toRepay;

                    await this.repayRepository.updateBorrowPositionDebt(
                        manager,
                        pos.id,
                        newDebt.toString(),
                    );
                    remaining -= toRepay;
                }
            });
            this.logger.log(`Repay DB state updated for tx: ${txHash}`);
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
