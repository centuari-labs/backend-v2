import { Injectable, BadRequestException, Logger } from "@nestjs/common";
import { ViemService } from "../core/viem/viem.service";
import { faucetAbi } from "../abis/Faucet";
import { ConfigService } from "@nestjs/config";
import { FaucetResponseDto, TokenMintResultDto } from "./dto/faucet.dto";
import type { TransactionReceipt } from "viem";

interface MintOutcome {
    tokenAddress: string;
    amount: string;
    receipt?: TransactionReceipt;
    error?: string;
}

@Injectable()
export class FaucetService {
    private readonly logger = new Logger(FaucetService.name);
    private readonly isDevMode: boolean;

    constructor(
        private readonly viemService: ViemService,
        private readonly configService: ConfigService,
    ) {
        this.isDevMode =
            this.configService.get<string>("AUTH_MODE") === "development";

        if (this.isDevMode) {
            this.logger.warn(
                "FAUCET running in DEV MODE -- returning mock responses",
            );
        }
    }

    private resolveTokenAddresses(
        chainId: number,
        requestedToken: string | string[],
    ): string[] {
        const raw = this.configService.get<string>(`FAUCET_TOKENS_${chainId}`);
        if (!raw) {
            throw new BadRequestException(
                `No tokens configured for faucet on chain ${chainId}`,
            );
        }
        const addresses = raw
            .split(",")
            .map((a) => a.trim())
            .filter(Boolean);

        if (requestedToken === "all-assets") {
            return addresses;
        }

        const requestedArray = Array.isArray(requestedToken)
            ? requestedToken
            : [requestedToken];
        for (const reqToken of requestedArray) {
            if (typeof reqToken !== "string" || !addresses.includes(reqToken)) {
                throw new BadRequestException(
                    `Token address ${reqToken} is not supported on chain ${chainId}`,
                );
            }
        }

        return requestedArray;
    }

    async requestTokens(
        chainId: number,
        recipientAddress: string,
        token: string | string[],
    ): Promise<FaucetResponseDto> {
        if (this.isDevMode) {
            return this.mockRequestTokens(chainId, recipientAddress, token);
        }

        const operatorKey = this.configService.get<string>(
            "OPERATOR_PRIVATE_KEY",
        );
        const faucetAddress = this.configService.get<string>(
            `FAUCET_ADDRESS_${chainId}`,
        );

        if (!operatorKey || !faucetAddress) {
            this.logger.warn(
                `Faucet not fully configured for chain ${chainId} — falling back to mock response`,
            );
            return this.mockRequestTokens(chainId, recipientAddress, token);
        }

        const tokenAddresses = this.resolveTokenAddresses(chainId, token);

        const mintResults = await Promise.allSettled(
            tokenAddresses.map((tokenAddress) =>
                this.mintToken(
                    chainId,
                    operatorKey,
                    faucetAddress,
                    tokenAddress,
                    recipientAddress,
                ),
            ),
        );

        const outcomes: MintOutcome[] = mintResults.map((outcome, idx) => {
            if (outcome.status === "fulfilled") {
                return outcome.value;
            }

            this.logger.error(
                `Failed to mint token=${tokenAddresses[idx]} for recipient=${recipientAddress}: ${outcome.reason}`,
            );

            return {
                tokenAddress: tokenAddresses[idx],
                amount: "0",
                error:
                    outcome.reason instanceof Error
                        ? outcome.reason.message
                        : String(outcome.reason),
            };
        });

        const firstSuccess = outcomes.find((o) => o.receipt);
        const results: TokenMintResultDto[] = outcomes.map((o) => ({
            tokenAddress: o.tokenAddress,
            amount: o.amount,
        }));

        return {
            chainId,
            recipientAddress,
            transactionHash:
                firstSuccess?.receipt?.transactionHash ?? `0x${"0".repeat(64)}`,
            blockNumber: firstSuccess?.receipt?.blockNumber?.toString() ?? "0",
            status: firstSuccess ? firstSuccess.receipt!.status : "failed",
            results,
        };
    }

    async requestTokensBatch(
        chainId: number,
        recipientAddress: string,
        tokenAddresses: string[],
        amounts: string[],
    ): Promise<FaucetResponseDto> {
        if (this.isDevMode) {
            return this.mockRequestTokens(
                chainId,
                recipientAddress,
                "all-assets",
            );
        }

        const operatorKey = this.configService.get<string>(
            "OPERATOR_PRIVATE_KEY",
        );
        const faucetAddress = this.configService.get<string>(
            `FAUCET_ADDRESS_${chainId}`,
        );

        if (!operatorKey || !faucetAddress) {
            this.logger.warn(
                `Faucet not fully configured for chain ${chainId} — falling back to mock response`,
            );
            return this.mockRequestTokens(
                chainId,
                recipientAddress,
                "all-assets",
            );
        }

        const mintResults = await Promise.allSettled(
            tokenAddresses.map((tokenAddress, idx) =>
                this.mintToken(
                    chainId,
                    operatorKey,
                    tokenAddress,
                    recipientAddress,
                    amounts[idx],
                ),
            ),
        );

        const outcomes: MintOutcome[] = mintResults.map((outcome, idx) => {
            if (outcome.status === "fulfilled") {
                return outcome.value;
            }

            this.logger.error(
                `Failed to mint token=${tokenAddresses[idx]} for recipient=${recipientAddress}: ${outcome.reason}`,
            );

            return {
                tokenAddress: tokenAddresses[idx],
                amount: "0",
                error:
                    outcome.reason instanceof Error
                        ? outcome.reason.message
                        : String(outcome.reason),
            };
        });

        const firstSuccess = outcomes.find((o) => o.receipt);
        const results: TokenMintResultDto[] = outcomes.map((o) => ({
            tokenAddress: o.tokenAddress,
            amount: o.amount,
        }));

        return {
            chainId,
            recipientAddress,
            transactionHash:
                firstSuccess?.receipt?.transactionHash ?? `0x${"0".repeat(64)}`,
            blockNumber: firstSuccess?.receipt?.blockNumber?.toString() ?? "0",
            status: firstSuccess ? firstSuccess.receipt!.status : "failed",
            results,
        };
    }

    async getTokens(chainId: number): Promise<string[]> {
        return this.resolveTokenAddresses(chainId, "all-assets");
    }

    private async mintToken(
        chainId: number,
        operatorKey: string,
        faucetAddress: string,
        tokenAddress: string,
        recipientAddress: string,
    ): Promise<MintOutcome> {
        const [enabled, maxPerRequest] = await this.viemService.readContract<
            [boolean, bigint, bigint]
        >(chainId, faucetAddress, faucetAbi, "configOf", [tokenAddress]);

        if (!enabled) {
            throw new BadRequestException(
                `Token ${tokenAddress} not enabled on faucet`,
            );
        }

        const receipt = (await this.viemService.writeContract(
            chainId,
            operatorKey,
            faucetAddress,
            faucetAbi,
            "mintTo",
            [tokenAddress, recipientAddress, maxPerRequest],
            { waitForReceipt: true },
        )) as TransactionReceipt;

        return {
            tokenAddress,
            amount: maxPerRequest.toString(),
            receipt,
        };
    }

    private mockRequestTokens(
        chainId: number,
        recipientAddress: string,
        token: string | string[],
    ): FaucetResponseDto {
        // In DEV mode we don't need real config -- use whatever is configured or fall back to placeholders.
        let tokenAddresses: string[];
        try {
            tokenAddresses = this.resolveTokenAddresses(chainId, token);
        } catch {
            if (token === "all-assets") {
                tokenAddresses = [
                    "0xMockToken1000000000000000000000000000001",
                    "0xMockToken2000000000000000000000000000002",
                ];
            } else {
                tokenAddresses = Array.isArray(token) ? token : [token]; // Return what they requested
            }
        }

        this.logger.debug(
            `[DEV] Mock mint: tokens=${tokenAddresses.join(",")}, recipient=${recipientAddress}, chain=${chainId}`,
        );

        const results: TokenMintResultDto[] = tokenAddresses.map(
            (tokenAddress) => ({
                tokenAddress,
                amount: "1000000000000000000",
            }),
        );

        return {
            chainId,
            recipientAddress,
            transactionHash: `0x${"0".repeat(64)}`,
            blockNumber: "0",
            status: "success",
            results,
        };
    }
}
