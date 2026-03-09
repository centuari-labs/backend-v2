import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { parseUnits, formatUnits } from "viem";
import { ViemService } from "../core/viem/viem.service";
import { TokensService } from "../tokens/tokens.service";
import { TokensRepository } from "../tokens/repositories/tokens.repository";
import { compareTokensByPriority } from "../tokens/token-order.config";
import { erc20Abi } from "../abis/ERC20";
import type { DepositTokenDto, BalanceResponseDto } from "./dto/deposit.dto";

@Injectable()
export class DepositService {
    private readonly logger = new Logger(DepositService.name);
    private readonly isDevMode: boolean;
    private readonly chainId: number;

    constructor(
        private readonly tokensService: TokensService,
        private readonly tokensRepository: TokensRepository,
        private readonly viemService: ViemService,
        private readonly configService: ConfigService,
    ) {
        this.isDevMode =
            this.configService.get<string>("NODE_ENV") !== "production";
        this.chainId = Number(
            this.configService.get<string>("DEPOSIT_CHAIN_ID") ?? "421614",
        );
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
            this.chainId,
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
}
