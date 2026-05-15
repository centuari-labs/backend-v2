import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { parseUnits, formatUnits, erc20Abi } from "viem";
import { ViemService } from "../core/viem/viem.service";
import { ChainConfigService } from "../core/chain-config/chain-config.service";
import { TokensService } from "../tokens/tokens.service";
import { TokensRepository } from "../tokens/repositories/tokens.repository";
import { ChainIndexerService } from "../chain-indexer/chain-indexer.service";
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
        private readonly chainIndexerService: ChainIndexerService,
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

    async confirmDeposit(txHash: string): Promise<ConfirmDepositResponseDto> {
        const processed =
            await this.chainIndexerService.processTransactionDeposits(txHash);
        this.logger.log(
            `Deposit confirmed: txHash=${txHash}, processed=${processed}`,
        );
        return { processed };
    }
}
