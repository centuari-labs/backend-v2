import { Injectable, Logger, BadRequestException, NotFoundException, InternalServerErrorException } from "@nestjs/common";
import { DataSource } from "typeorm";
import { OrderRepository } from "../orders/repositories/order.repository";
import { ViemService } from "../core/viem/viem.service";
import { TokensService } from "../tokens/tokens.service";
import { ConfigService } from "@nestjs/config";
import { RepayRepository } from "./repositories/repay.repository";
import { RepayRequestDto, RepayResponseDto } from "./dto/repay.dto";
import { parseUnits } from "viem";
import type { TransactionReceipt } from "viem";
import { centuariAbi } from "../../abis/centuari";
import { Token } from "../tokens/entities/token.entity";
import { Account } from "../orders/entities/account.entity";

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
        private readonly dataSource: DataSource,
    ) {
        this.chainId = Number(this.configService.get<string>("DEPOSIT_CHAIN_ID") ?? "421614");
        this.operatorPrivateKey = this.configService.get<string>("OPERATOR_PRIVATE_KEY") ?? "";
        this.centuariAddress = this.configService.get<string>("CENTUARI_ADDRESS") ?? "";
    }

    async repay(dto: RepayRequestDto): Promise<RepayResponseDto> {
        const { borrowerAddress, assetId, maturity, amount } = dto;

        const account = await this.validateAccount(borrowerAddress);
        const resolvedAssetId = await this.resolveAssetId(assetId);
        const loanToken = await this.validateToken(resolvedAssetId);

        const totalDebtStr = await this.repayRepository.getUserTotalDebt(account.id, resolvedAssetId);
        const decimals = loanToken.decimals ?? 18;
        const totalDebtBaseUnits = BigInt(totalDebtStr);
        const repayAmountBaseUnits = this.parseRepayAmount(amount, decimals, totalDebtBaseUnits);

        const positions = await this.getFilteredPositions(account.id, resolvedAssetId, maturity, repayAmountBaseUnits);

        this.logger.log(`Executing repay: token=${loanToken.tokenAddress}, user=${borrowerAddress}, amount=${repayAmountBaseUnits}, maturity=${maturity}`);

        const txHash = await this.executeBlockchainRepay(borrowerAddress, loanToken.tokenAddress, BigInt(maturity), repayAmountBaseUnits);

        await this.updateDatabaseState(positions, repayAmountBaseUnits, txHash, account.id, resolvedAssetId);

        return { txHash, status: "success" };
    }

    private async validateAccount(address: string): Promise<Account> {
        const account = await this.orderRepository.findAccountByWallet(address);
        if (!account) throw new NotFoundException("Account not found");
        return account;
    }

    private async resolveAssetId(assetId: string): Promise<string> {
        if (!assetId.startsWith("0x")) return assetId;
        const uuid = await this.repayRepository.getAssetIdByTokenAddress(assetId);
        if (!uuid) throw new NotFoundException(`Token with address ${assetId} not found`);
        return uuid;
    }

    private async validateToken(assetId: string): Promise<Token> {
        const token = await this.tokensService.getTokenByAssetId(assetId);
        if (!token) throw new NotFoundException("Token not found");
        return token;
    }

    private parseRepayAmount(amount: string, decimals: number, totalDebt: bigint): bigint {
        const amountNum = Number(amount);
        if (Number.isNaN(amountNum) || amountNum <= 0) {
            throw new BadRequestException("Invalid repay amount");
        }

        try {
            const baseUnits = parseUnits(amount, decimals);
            if (baseUnits > totalDebt) {
                throw new BadRequestException(`Repay amount (${amount}) exceeds total debt`);
            }
            if (baseUnits <= 0n) {
                throw new BadRequestException("Repay amount must be greater than zero");
            }
            return baseUnits;
        } catch (error) {
            if (error instanceof BadRequestException) throw error;
            throw new BadRequestException("Invalid amount format for this token");
        }
    }

    private async getFilteredPositions(accountId: string, assetId: string, maturity: number, repayAmount: bigint): Promise<any[]> {
        const borrowPositions = await this.repayRepository.getBorrowPositions(accountId, assetId);

        this.logger.debug(`Raw borrowPositions from repo: ${JSON.stringify(borrowPositions)}`);

        if (!borrowPositions || borrowPositions.length === 0) {
            this.logger.warn(`No borrow positions found in DB for accountId=${accountId}, assetId=${assetId}`);
            throw new BadRequestException("No active borrow positions found");
        }

        const targetMaturity = BigInt(maturity);
        const filtered = targetMaturity > 0n
            ? borrowPositions.filter((p) => {
                let maturityUnix: number;
                if (!p.maturity) {
                    maturityUnix = 0;
                } else if (p.maturity instanceof Date) {
                    maturityUnix = Math.floor(p.maturity.getTime() / 1000);
                } else if (!isNaN(Number(p.maturity))) {
                    maturityUnix = Math.floor(Number(p.maturity));
                } else {
                    const date = new Date(p.maturity);
                    maturityUnix = isNaN(date.getTime()) ? 0 : Math.floor(date.getTime() / 1000);
                }
                return BigInt(maturityUnix) === targetMaturity;
            })
            : borrowPositions;

        if (filtered.length === 0) {
            throw new BadRequestException(`No active borrow positions found for maturity ${maturity}`);
        }

        const totalAvailable = filtered.reduce((sum, p) => sum + BigInt(p.debt), 0n);
        if (repayAmount > totalAvailable) {
            throw new BadRequestException("Repay amount exceeds available debt for target maturity");
        }

        return filtered;
    }

    private async executeBlockchainRepay(borrower: string, token: string, maturity: bigint, amount: bigint): Promise<string> {
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
                throw new BadRequestException("Contract reverted: InvalidAmount. Check maturity and amount.");
            }
            throw new InternalServerErrorException(`Blockchain transaction failed: ${error.message}`);
        }
    }

    private async updateDatabaseState(positions: any[], repayAmount: bigint, txHash: string, accountId: string, assetId: string): Promise<void> {
        try {
            await this.dataSource.transaction(async (manager) => {
                // Re-fetch positions with lock within the transaction
                const positionsToUpdate = await this.repayRepository.getBorrowPositionsForUpdate(manager, accountId, assetId);
                
                // Map position IDs for quick lookup to maintain filter logic from getFilteredPositions
                const validIds = new Set(positions.map(p => p.id));
                const targetPositions = positionsToUpdate.filter(p => validIds.has(p.id));

                let remaining = repayAmount;
                for (const pos of targetPositions) {
                    if (remaining <= 0n) break;

                    const debt = BigInt(pos.debt);
                    const toRepay = remaining >= debt ? debt : remaining;

                    if (remaining >= debt) {
                        await this.repayRepository.deleteBorrowPosition(manager, pos.id);
                        remaining -= debt;
                    } else {
                        await this.repayRepository.updateBorrowPositionDebt(manager, pos.id, (debt - remaining).toString());
                        remaining = 0n;
                    }
                }
            });
            this.logger.log(`Repay DB state updated for tx: ${txHash}`);
        } catch (error: any) {
            this.logger.error(`CRITICAL: Blockchain tx succeeded (${txHash}) but DB update failed: ${error.message}`);
            throw new InternalServerErrorException("Repay finalized on-chain but failed local state update.");
        }
    }
}
