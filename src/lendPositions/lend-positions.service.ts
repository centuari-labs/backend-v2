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
import { ConfigService } from "@nestjs/config";
import { LendPositionsRepository } from "./repositories/lend-positions.repository";
import {
    WithdrawLendPositionDto,
    WithdrawLendPositionResponseDto,
} from "./dto/withdraw-lend-position.dto";
import type { TransactionReceipt } from "viem";
import { centuariAbi } from "../../abis/centuari";

@Injectable()
export class LendPositionsService {
    private readonly logger = new Logger(LendPositionsService.name);
    private readonly chainId: number;
    private readonly operatorPrivateKey: string;
    private readonly centuariAddress: string;

    constructor(
        private readonly viemService: ViemService,
        private readonly orderRepository: OrderRepository,
        private readonly lendPositionsRepository: LendPositionsRepository,
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

    async withdrawLendPosition(
        dto: WithdrawLendPositionDto,
        walletAddress: string,
        privyUserId: string,
    ): Promise<WithdrawLendPositionResponseDto> {
        const { marketId } = dto;

        const accountId = await this.orderRepository
            .getOrCreateAccount(walletAddress, privyUserId)
            .then((a) => a.id);

        const market =
            await this.lendPositionsRepository.getMarketWithAsset(marketId);
        if (!market) {
            throw new NotFoundException("Market not found");
        }

        const positions = await this.lendPositionsRepository.getLendPositions(
            accountId,
            marketId,
        );
        if (!positions || positions.length === 0) {
            throw new BadRequestException(
                "No active lend positions found for this market",
            );
        }

        const maturityDate = market.maturity ? new Date(market.maturity) : null;
        if (!maturityDate) {
            throw new BadRequestException("Market has no maturity date");
        }

        const maturityUnix = Math.floor(maturityDate.getTime() / 1000);
        const nowUnix = Math.floor(Date.now() / 1000);
        if (nowUnix < maturityUnix) {
            throw new BadRequestException("Position has not matured yet");
        }

        // Sum all shares for full withdrawal
        let totalShares = 0n;
        for (const pos of positions) {
            const sharesStr = pos.shares.toString().split(".")[0];
            totalShares += BigInt(sharesStr);
        }

        if (totalShares <= 0n) {
            throw new BadRequestException("No shares available for withdrawal");
        }

        this.logger.log(
            `Executing withdrawLendPosition: token=${market.tokenAddress}, maturity=${maturityUnix}, cbtAmount=${totalShares}`,
        );

        const txHash = await this.executeBlockchainWithdraw(
            market.tokenAddress,
            BigInt(maturityUnix),
            totalShares,
        );

        await this.updateDatabaseState(positions, txHash);

        return { txHash, status: "success" };
    }

    private async executeBlockchainWithdraw(
        loanToken: string,
        maturity: bigint,
        cbtAmount: bigint,
    ): Promise<string> {
        try {
            const receipt = (await this.viemService.writeContract(
                this.chainId,
                this.operatorPrivateKey,
                this.centuariAddress,
                centuariAbi,
                "withdrawLendPosition",
                [loanToken, maturity, cbtAmount],
                { waitForReceipt: true },
            )) as TransactionReceipt;
            return receipt.transactionHash;
        } catch (error: any) {
            this.logger.error(`Contract call failed: ${error.message}`);
            if (error.message.includes("NotMatured")) {
                throw new BadRequestException(
                    "Contract reverted: position has not matured yet.",
                );
            }
            if (error.message.includes("InsufficientBalance")) {
                throw new BadRequestException(
                    "Contract reverted: insufficient CBT balance.",
                );
            }
            throw new InternalServerErrorException(
                `Blockchain transaction failed: ${error.message}`,
            );
        }
    }

    private async updateDatabaseState(
        positions: any[],
        txHash: string,
    ): Promise<void> {
        try {
            await this.dataSource.transaction(async (manager) => {
                const lockedPositions =
                    await this.lendPositionsRepository.getLendPositions(
                        positions[0].account_id ?? positions[0].accountId,
                        positions[0].market_id ?? positions[0].marketId,
                        manager,
                    );

                for (const pos of lockedPositions) {
                    await this.lendPositionsRepository.updateLendPositionShares(
                        manager,
                        pos.id,
                        "0",
                    );
                }
            });
            this.logger.log(
                `Withdraw lend position DB state updated for tx: ${txHash}`,
            );
        } catch (error: any) {
            this.logger.error(
                `CRITICAL: Blockchain tx succeeded (${txHash}) but DB update failed: ${error.message}`,
            );
            throw new InternalServerErrorException(
                "Withdraw finalized on-chain but failed local state update.",
            );
        }
    }
}
