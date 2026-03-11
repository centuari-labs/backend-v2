import { Injectable, Logger, BadRequestException, NotFoundException, InternalServerErrorException } from "@nestjs/common";
import { OrderRepository } from "../orders/repositories/order.repository";
import { ViemService } from "../core/viem/viem.service";
import { TokensService } from "../tokens/tokens.service";
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
        private readonly tokensService: TokensService,
        private readonly orderRepository: OrderRepository,
        private readonly repayRepository: RepayRepository,
        private readonly configService: ConfigService,
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
    ): Promise<RepayResponseDto> {
        const { assetId, amount } = dto;

        const amountNum = Number(amount);
        if (Number.isNaN(amountNum) || amountNum <= 0) {
            throw new BadRequestException("Invalid repay amount");
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

        const totalDebtStr = await this.repayRepository.getUserTotalDebt(
            account.id,
            assetId,
        );

        this.logger.debug(`Wallet: ${walletAddress} | Account ID: ${account.id} | Asset ID: ${assetId} | Total Debt DB: ${totalDebtStr}`);

        const decimals = token.decimals ?? 18;
        const totalDebtBaseUnits = BigInt(totalDebtStr);

        let repayAmountBaseUnits: bigint;
        try {
            if (amount.includes(".")) {
                repayAmountBaseUnits = parseUnits(amount, decimals);
            } else {
                repayAmountBaseUnits = parseUnits(amount, decimals);
            }
        } catch (error) {
            throw new BadRequestException("Invalid amount format for this token");
        }

        this.logger.debug(`Repay Payload - amount: ${amount}, decimals: ${decimals}`);
        this.logger.debug(`Parsed: repayAmountBaseUnits=${repayAmountBaseUnits.toString()}, totalDebtBaseUnits=${totalDebtBaseUnits.toString()}`);

        if (repayAmountBaseUnits > totalDebtBaseUnits) {
            throw new BadRequestException(`Repay amount (${amount}) exceeds total debt (${totalDebtStr})`);
        }

        if (repayAmountBaseUnits <= 0n) {
            throw new BadRequestException("Repay amount must be greater than zero");
        }

        this.logger.log(
            `Executing repay: token=${token.tokenAddress}, user=${walletAddress}, amount=${repayAmountBaseUnits}`,
        );

        const queryRunner = this.repayRepository.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            const borrowPositions =
                await this.repayRepository.getBorrowPositionsForUpdate(
                    queryRunner,
                    account.id,
                    assetId,
                );

            if (!borrowPositions || borrowPositions.length === 0) {
                throw new BadRequestException("No active borrow positions found");
            }

            let remainingRepay = repayAmountBaseUnits;
            const receipts: TransactionReceipt[] = [];

            for (const position of borrowPositions) {
                if (remainingRepay <= 0n) break;

                const positionDebt = BigInt(position.debt);
                const amountToRepay = remainingRepay >= positionDebt ? positionDebt : remainingRepay;

                // Track maturity for this specific position
                const maturity = position.maturity
                    ? BigInt(Math.floor(new Date(position.maturity).getTime() / 1000))
                    : 0n;

                this.logger.debug(`Repaying position ${position.id}: amount=${amountToRepay}, maturity=${maturity}`);

                try {
                    const receipt = (await this.viemService.writeContract(
                        this.chainId,
                        this.operatorPrivateKey,
                        this.centuariAddress,
                        centuariAbi,
                        "repay",
                        [walletAddress, token.tokenAddress, maturity, amountToRepay],
                        { waitForReceipt: true },
                    )) as TransactionReceipt;

                    receipts.push(receipt);
                } catch (contractError: any) {
                    this.logger.error(`Contract call failed for position ${position.id}: ${contractError.message}`);
                    if (contractError.message.includes("InvalidAmount")) {
                        throw new BadRequestException("Contract reverted: InvalidAmount. The repayment amount may be invalid for this maturity.");
                    }
                    throw new InternalServerErrorException(`Blockchain transaction failed: ${contractError.message}`);
                }

                if (remainingRepay >= positionDebt) {
                    await this.repayRepository.deleteBorrowPosition(queryRunner, position.id);
                    remainingRepay -= positionDebt;
                } else {
                    const newDebt = positionDebt - remainingRepay;
                    await this.repayRepository.updateBorrowPositionDebt(
                        queryRunner,
                        position.id,
                        newDebt.toString(),
                    );
                    remainingRepay = 0n;
                }
            }

            if (remainingRepay > 0n) {
                throw new InternalServerErrorException(
                    "Database state mismatch: remaining repay > 0",
                );
            }

            await queryRunner.commitTransaction();

            const lastReceipt = receipts[receipts.length - 1];
            this.logger.log(
                `Repay combined successful: total_amount=${amount} ${token.symbol}, txs=${receipts.length}`,
            );

            return {
                txHash: lastReceipt.transactionHash,
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
