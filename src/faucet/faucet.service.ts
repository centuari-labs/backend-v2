import { Injectable, BadRequestException, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { ViemService } from "../core/viem/viem.service";
import { faucetAbi } from "../abis/Faucet";
import { ConfigService } from "@nestjs/config";
import { Token } from "../tokens/entities/token.entity";
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
    private readonly isDevMode: boolean = false;

    constructor(
        @InjectRepository(Token)
        private readonly tokenRepository: Repository<Token>,
        private readonly viemService: ViemService,
        private readonly configService: ConfigService,
    ) {
        // this.isDevMode =
        //     this.configService.get<string>("NODE_ENV") !== "production";
        // if (this.isDevMode) {
        //     this.logger.warn(
        //         "FAUCET running in DEV MODE -- returning mock responses",
        //     );
        // }
    }

    /**
     * If any requested token looks like a symbol (not starting with 0x),
     * look it up in the assets table and replace with the on-chain address.
     * Passes through "all-assets" and 0x-prefixed addresses unchanged.
     */
    private async resolveSymbolsToAddresses(
        token: string | string[],
    ): Promise<string | string[]> {
        if (token === "all-assets") return token;

        const tokens = Array.isArray(token) ? token : [token];
        const symbols = tokens.filter(
            (t) => typeof t === "string" && !t.startsWith("0x"),
        );

        if (symbols.length === 0) return token;

        const rows = await this.tokenRepository.find({
            where: { symbol: In(symbols.map((s) => s.toUpperCase())) },
            select: ["symbol", "tokenAddress"],
        });

        const symbolToAddress = new Map<string, string>();
        for (const row of rows) {
            symbolToAddress.set(row.symbol.toUpperCase(), row.tokenAddress);
        }

        const resolved = tokens.map((t) => {
            if (t.startsWith("0x")) return t;
            const address = symbolToAddress.get(t.toUpperCase());
            if (!address) {
                throw new BadRequestException(`Unknown token symbol: ${t}`);
            }
            return address;
        });

        return Array.isArray(token) ? resolved : resolved[0];
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
            .map((a) => a.trim().replace(/^["']|["']$/g, ""))
            .filter(Boolean);

        if (requestedToken === "all-assets") {
            return addresses;
        }

        this.logger.debug(
            `Configured faucet tokens for chain ${chainId}: ${addresses.join(",")}`,
        );

        const lowerAddresses = addresses.map((a) => a.toLowerCase());

        this.logger.debug(
            `Normalized faucet token addresses for chain ${chainId}: ${lowerAddresses.join(",")}`,
        );

        const requestedArray = Array.isArray(requestedToken)
            ? requestedToken
            : [requestedToken];

        this.logger.debug(
            `Requested tokens to mint for chain ${chainId}: ${requestedArray.join(",")}`,
        );

        for (const reqToken of requestedArray) {
            if (
                typeof reqToken !== "string" ||
                !lowerAddresses.includes(reqToken.toLowerCase())
            ) {
                throw new BadRequestException(
                    `Token address ${reqToken} is not supported on chain ${chainId}`,
                );
            }
        }

        this.logger.debug(
            `Resolved token addresses for request: ${requestedArray.join(",")}`,
        );

        return requestedArray;
    }

    async requestTokens(
        chainId: number,
        recipientAddress: string,
        token: string | string[],
    ): Promise<FaucetResponseDto> {
        this.logger.debug(
            `Received faucet request: chainId=${chainId}, recipient=${recipientAddress}, token=${Array.isArray(token) ? token.join(",") : token}`,
        );
        // Resolve symbols (e.g. "usdt") to on-chain addresses from DB
        const resolvedToken = await this.resolveSymbolsToAddresses(token);

        this.logger.debug(
            `Resolved token addresses: ${Array.isArray(resolvedToken) ? resolvedToken.join(",") : resolvedToken}`,
        );

        this.logger.debug("this.isDevMode", this.isDevMode);

        if (this.isDevMode) {
            return this.mockRequestTokens(
                chainId,
                recipientAddress,
                resolvedToken,
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
                resolvedToken,
            );
        }

        const tokenAddresses = this.resolveTokenAddresses(
            chainId,
            resolvedToken,
        );

        this.logger.debug(
            `Requesting tokens from faucet: chainId=${chainId}, recipient=${recipientAddress}, tokens=${tokenAddresses.join(
                ",",
            )}`,
        );

        const outcomes: MintOutcome[] = [];
        for (const tokenAddress of tokenAddresses) {
            try {
                const result = await this.mintToken(
                    chainId,
                    operatorKey,
                    faucetAddress,
                    tokenAddress,
                    recipientAddress,
                );
                outcomes.push(result);
            } catch (error) {
                this.logger.error(
                    `Failed to mint token=${tokenAddress} for recipient=${recipientAddress}: ${error}`,
                );
                outcomes.push({
                    tokenAddress,
                    amount: "0",
                    error:
                        error instanceof Error ? error.message : String(error),
                });
            }
        }

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

    private static readonly MAX_BATCH = 9;

    /**
     * Request multiple tokens in bulk via the Faucet contract's mintBatch (1 tx per chunk of 9).
     * When amounts is omitted, derives from configOf.maxPerRequest per token.
     */
    async requestTokensBatch(
        chainId: number,
        recipientAddress: string,
        tokenAddresses: string[],
        amounts?: string[],
    ): Promise<FaucetResponseDto> {
        if (this.isDevMode) {
            return this.mockRequestTokens(
                chainId,
                recipientAddress,
                tokenAddresses.length > 0 ? tokenAddresses : "all-assets",
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
                tokenAddresses.length > 0 ? tokenAddresses : "all-assets",
            );
        }

        if (tokenAddresses.length === 0) {
            return {
                chainId,
                recipientAddress,
                transactionHash: `0x${"0".repeat(64)}`,
                blockNumber: "0",
                status: "success",
                results: [],
            };
        }

        // Read configOf for each token in parallel
        const configs = await Promise.all(
            tokenAddresses.map((tokenAddress) =>
                this.viemService
                    .readContract<[boolean, bigint, bigint]>(
                        chainId,
                        faucetAddress,
                        faucetAbi,
                        "configOf",
                        [tokenAddress],
                    )
                    .then(([enabled, maxPerRequest]) => ({
                        tokenAddress,
                        enabled,
                        maxPerRequest,
                    }))
                    .catch((err) => {
                        this.logger.debug(
                            `configOf failed for ${tokenAddress}: ${(err as Error).message}`,
                        );
                        return {
                            tokenAddress,
                            enabled: false,
                            maxPerRequest: 0n,
                        };
                    }),
            ),
        );

        // Build tokens and amounts: use provided amounts when valid, else maxPerRequest
        const tokensToMint: string[] = [];
        const amountsToMint: bigint[] = [];

        for (let i = 0; i < configs.length; i++) {
            const { tokenAddress, enabled, maxPerRequest } = configs[i];
            if (!enabled) continue;

            let amount: bigint;
            if (amounts && amounts[i] !== undefined && amounts[i] !== "") {
                try {
                    amount = BigInt(amounts[i]);
                } catch {
                    amount = maxPerRequest;
                }
            } else {
                amount = maxPerRequest;
            }

            if (amount <= 0n) continue;

            tokensToMint.push(tokenAddress);
            amountsToMint.push(amount);
        }

        if (tokensToMint.length === 0) {
            return {
                chainId,
                recipientAddress,
                transactionHash: `0x${"0".repeat(64)}`,
                blockNumber: "0",
                status: "success",
                results: tokenAddresses.map((addr) => ({
                    tokenAddress: addr,
                    amount: "0",
                })),
            };
        }

        const results: TokenMintResultDto[] = tokenAddresses.map((addr) => {
            const idx = tokensToMint.indexOf(addr);
            return {
                tokenAddress: addr,
                amount: idx >= 0 ? amountsToMint[idx].toString() : "0",
            };
        });

        // Chunk by MAX_BATCH and call mintBatch for each chunk
        let firstReceipt: TransactionReceipt | undefined;

        for (
            let start = 0;
            start < tokensToMint.length;
            start += FaucetService.MAX_BATCH
        ) {
            const chunkTokens = tokensToMint.slice(
                start,
                start + FaucetService.MAX_BATCH,
            );
            const chunkAmounts = amountsToMint.slice(
                start,
                start + FaucetService.MAX_BATCH,
            );

            const receipt = await this.writeWithNonceRetry(
                chainId,
                operatorKey,
                faucetAddress,
                faucetAbi,
                "mintBatch",
                [chunkTokens, chunkAmounts, recipientAddress],
            );

            if (!firstReceipt) firstReceipt = receipt;
        }

        return {
            chainId,
            recipientAddress,
            transactionHash:
                firstReceipt?.transactionHash ?? `0x${"0".repeat(64)}`,
            blockNumber: firstReceipt?.blockNumber?.toString() ?? "0",
            status: firstReceipt?.status ?? "success",
            results,
        };
    }

    async getTokens(chainId: number): Promise<string[]> {
        return this.resolveTokenAddresses(chainId, "all-assets");
    }

    private isNonceError(error: unknown): boolean {
        const msg = ((error as Error).message ?? "").toLowerCase();
        return (
            msg.includes("nonce too low") ||
            msg.includes("nonce too high") ||
            msg.includes("lower than the current nonce") ||
            msg.includes("higher than the next one expected")
        );
    }

    private async writeWithNonceRetry(
        chainId: number,
        privateKey: string,
        address: string,
        abi: readonly any[],
        functionName: string,
        args: any[],
    ): Promise<TransactionReceipt> {
        try {
            return (await this.viemService.writeContract(
                chainId,
                privateKey,
                address,
                abi,
                functionName,
                args,
                { waitForReceipt: true },
            )) as TransactionReceipt;
        } catch (e) {
            if (!this.isNonceError(e)) throw e;

            this.logger.warn(
                `Nonce error on ${functionName}; resetting wallet client and retrying`,
            );
            this.viemService.resetWalletClient(privateKey, chainId);
            await new Promise((r) => setTimeout(r, 2000));
            return (await this.viemService.writeContract(
                chainId,
                privateKey,
                address,
                abi,
                functionName,
                args,
                { waitForReceipt: true },
            )) as TransactionReceipt;
        }
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

        const receipt = await this.writeWithNonceRetry(
            chainId,
            operatorKey,
            faucetAddress,
            faucetAbi,
            "mintTo",
            [tokenAddress, recipientAddress, maxPerRequest],
        );

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
