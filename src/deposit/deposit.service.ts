import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { parseUnits, formatUnits, erc20Abi } from "viem";
import { ViemService } from "../core/viem/viem.service";
import { ChainConfigService } from "../core/chain-config/chain-config.service";
import { DatabaseService } from "../core/database/database.service";
import { applyDepositEffects } from "../core/on-chain-state/apply-deposit";
import { TokensService } from "../tokens/tokens.service";
import { TokensRepository } from "../tokens/repositories/tokens.repository";
import { compareTokensByPriority } from "../tokens/token-order.config";
import type {
    DepositTokenDto,
    BalanceResponseDto,
    ConfirmDepositResponseDto,
} from "./dto/deposit.dto";

@Injectable()
export class DepositService {
    private readonly logger = new Logger(DepositService.name);
    private readonly isDevMode: boolean;

    constructor(
        private readonly tokensService: TokensService,
        private readonly tokensRepository: TokensRepository,
        private readonly viemService: ViemService,
        private readonly configService: ConfigService,
        private readonly databaseService: DatabaseService,
        private readonly chainConfig: ChainConfigService,
    ) {
        this.isDevMode =
            this.configService.get<string>("NODE_ENV") !== "production";
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
            this.chainConfig.chainId,
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
        const sorted = tokens.slice().sort(compareTokensByPriority);

        return sorted.map((t) => ({
            id: t.id,
            symbol: t.symbol,
            name: t.name,
            tokenAddress: t.tokenAddress,
            decimals: t.decimals,
            imageUrl: t.imageUrl,
            chainId: t.chainId,
        }));
    }

    async confirmDeposit(
        txHash: string,
        walletAddress: string,
    ): Promise<ConfirmDepositResponseDto> {
        const receipt = await this.viemService.getTransactionReceipt(
            this.chainConfig.chainId,
            txHash as `0x${string}`,
        );
        if (receipt.status !== "success") {
            this.logger.warn(`Deposit tx ${txHash} reverted — skipping`);
            return { processed: 0 };
        }

        const processed = await applyDepositEffects({
            pool: this.databaseService.getPool(),
            client: this.viemService.getPublicClient(this.chainConfig.chainId),
            receipt,
            expectedUser: walletAddress as `0x${string}`,
            balanceLedgerAddress: this.chainConfig
                .balanceLedgerAddress as `0x${string}`,
        });
        this.logger.log(
            `Deposit confirmed: txHash=${txHash}, wallet=${walletAddress}, processed=${processed}`,
        );
        return { processed };
    }
}
