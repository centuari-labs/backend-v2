import { Injectable, BadRequestException, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrivyClient } from "@privy-io/server-auth";
import { encodeFunctionData, parseUnits, formatUnits } from "viem";
import { ViemService } from "../core/viem/viem.service";
import { TokensService } from "../tokens/tokens.service";
import { TokensRepository } from "../tokens/repositories/tokens.repository";
import { erc20Abi } from "../abis/ERC20";
import type {
    DepositResponseDto,
    DepositTokenDto,
    BalanceResponseDto,
} from "./dto/deposit.dto";

@Injectable()
export class DepositService {
    private readonly logger = new Logger(DepositService.name);
    private readonly isDevMode: boolean;
    private readonly treasuryAddress: string | undefined;
    private readonly chainId: number;
    private readonly privyAppId: string;
    private readonly privyAppSecret: string;

    constructor(
        private readonly tokensService: TokensService,
        private readonly tokensRepository: TokensRepository,
        private readonly viemService: ViemService,
        private readonly configService: ConfigService,
    ) {
        this.isDevMode =
            this.configService.get<string>("NODE_ENV") !== "production";
        this.treasuryAddress =
            this.configService.get<string>("TREASURY_ADDRESS");
        this.chainId = Number(
            this.configService.get<string>("DEPOSIT_CHAIN_ID") ?? "421614",
        );
        this.privyAppId = this.configService.get<string>(
            "PRIVY_APP_ID",
        ) as string;
        this.privyAppSecret = this.configService.get<string>(
            "PRIVY_PROJECT_SECRET",
        ) as string;

        if (this.isDevMode) {
            this.logger.warn(
                "DEPOSIT running in DEV MODE -- returning mock responses",
            );
        }
    }

    async deposit(
        assetId: string,
        amount: string,
        walletAddress: string,
        bearerToken: string,
    ): Promise<DepositResponseDto> {
        const token = await this.tokensService.getTokenByAssetId(assetId);
        const decimals = token.decimals ?? 18;

        if (this.isDevMode) {
            this.logger.debug(
                `[DEV] Mock deposit: asset=${assetId}, amount=${amount}, wallet=${walletAddress}`,
            );
            return {
                transactionHash: `0x${"0".repeat(64)}`,
                status: "submitted",
            };
        }

        if (!this.treasuryAddress) {
            throw new BadRequestException(
                "Treasury address is not configured",
            );
        }

        const amountWei = parseUnits(amount, decimals);
        const calldata = encodeFunctionData({
            abi: erc20Abi,
            functionName: "transfer",
            args: [this.treasuryAddress as `0x${string}`, amountWei],
        });

        // Create an isolated PrivyClient per request to avoid race conditions
        // from updateAuthorizationKey() mutating shared state.
        const privyClient = new PrivyClient(
            this.privyAppId,
            this.privyAppSecret,
        );

        const { authorizationKey, wallets } =
            await privyClient.walletApi.generateUserSigner({
                userJwt: bearerToken,
            });

        const userWallet = wallets.find(
            (w) =>
                w.address.toLowerCase() === walletAddress.toLowerCase() &&
                w.chainType === "ethereum",
        );

        if (!userWallet) {
            throw new BadRequestException(
                "Could not find matching Privy embedded wallet",
            );
        }

        privyClient.walletApi.updateAuthorizationKey(authorizationKey);

        const result = await privyClient.walletApi.ethereum.sendTransaction({
            walletId: userWallet.id,
            address: userWallet.address,
            chainType: "ethereum",
            caip2: `eip155:${this.chainId}`,
            transaction: {
                to: token.tokenAddress as `0x${string}`,
                data: calldata,
                value: "0x0" as `0x${string}`,
            },
        });

        this.logger.log(
            `Deposit tx submitted: hash=${result.hash}, wallet=${walletAddress}, asset=${assetId}, amount=${amount}`,
        );

        return {
            transactionHash: result.hash,
            status: "submitted",
        };
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
        return tokens.map((t) => ({
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
