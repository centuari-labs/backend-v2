import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
    createPublicClient,
    createWalletClient,
    http,
    isAddress,
    type PublicClient,
    type WalletClient,
    type Account,
    type Chain,
    type Hash,
    type TransactionReceipt,
    type Transport,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import * as chains from "viem/chains";

export interface ViemWriteContractOptions {
    value?: bigint;
    gas?: bigint;
    /**
     * If true, waits for the transaction receipt before returning.
     * @default false
     */
    waitForReceipt?: boolean;
}

@Injectable()
export class ViemService implements OnModuleInit {
    private readonly logger = new Logger(ViemService.name);

    private publicClients = new Map<number, PublicClient>();
    private walletClients = new Map<string, WalletClient<Transport, Chain, Account>>();
    private supportedChains = new Map<number, Chain>();

    constructor(private readonly configService: ConfigService) { }

    onModuleInit() {
        this.initializeChains();
    }

    private initializeChains() {
        const supportedChainsEnv = this.configService.get<string>("SUPPORTED_CHAINS");
        if (!supportedChainsEnv) {
            this.logger.warn("No SUPPORTED_CHAINS defined in environment");
            return;
        }

        const chainIds = supportedChainsEnv.split(",").map((id) => Number(id.trim()));

        for (const chainId of chainIds) {
            const chain = this.getViemChainById(chainId);
            if (!chain) {
                this.logger.error(`Chain ${chainId} not found in viem/chains`);
                continue;
            }
            this.supportedChains.set(chainId, chain);
            this.logger.log(`Initialized support for chain: ${chain.name} (${chainId})`);
        }
    }

    private getViemChainById(chainId: number): Chain | undefined {
        const allChains = Object.values(chains) as Chain[];
        return allChains.find((chain) => chain.id === chainId);
    }

    private getRpcUrl(chainId: number): string {
        const rpc = this.configService.get<string>(`RPC_${chainId}`);
        if (!rpc) {
            throw new Error(`Missing RPC configuration for chainId ${chainId}`);
        }
        return rpc;
    }

    private resolveChain(chainId: number): Chain {
        const chain = this.supportedChains.get(chainId);
        if (!chain) {
            const resolved = this.getViemChainById(chainId);
            if (resolved) {
                return resolved;
            }
            throw new Error(`Unsupported or unconfigured chainId: ${chainId}`);
        }
        return chain;
    }

    isValidAddress(address: string): boolean {
        return isAddress(address);
    }

    getPublicClient(chainId: number): PublicClient {
        if (!this.publicClients.has(chainId)) {
            const chain = this.resolveChain(chainId);
            const rpc = this.getRpcUrl(chainId);

            const client = createPublicClient({
                chain,
                transport: http(rpc),
            });

            this.publicClients.set(chainId, client as PublicClient);
            this.logger.debug(`Created public client for chainId: ${chainId}`);
        }

        const client = this.publicClients.get(chainId);
        if (!client) throw new Error(`Failed to initialize public client for chain ${chainId}`);
        return client;
    }

    getWalletClient(privateKey: string, chainId: number): WalletClient<Transport, Chain, Account> {
        const formattedKey = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
        const account = privateKeyToAccount(formattedKey as `0x${string}`);

        const key = `${chainId}-${account.address}`;

        if (!this.walletClients.has(key)) {
            const chain = this.resolveChain(chainId);
            const rpc = this.getRpcUrl(chainId);

            const client = createWalletClient({
                account,
                chain,
                transport: http(rpc),
            });

            this.walletClients.set(key, client as WalletClient<Transport, Chain, Account>);
            this.logger.debug(`Created wallet client for ${account.address} on chain ${chainId}`);
        }

        const client = this.walletClients.get(key);
        if (!client) throw new Error("Failed to initialize wallet client");
        return client;
    }

    generateWallet(): { address: string; privateKey: string } {
        const privateKey = generatePrivateKey();
        const account = privateKeyToAccount(privateKey);

        return {
            address: account.address,
            privateKey,
        };
    }

    async readContract<T = any>(
        chainId: number,
        address: string,
        abi: readonly any[],
        functionName: string,
        args: any[] = []
    ): Promise<T> {
        const client = this.getPublicClient(chainId);

        try {
            return (await client.readContract({
                address: address as `0x${string}`,
                abi,
                functionName,
                args,
            })) as T;
        } catch (error) {
            this.logger.error(
                `Failed to read contract ${address} on chain ${chainId}, function ${functionName}: ${(error as Error).message}`
            );
            throw error;
        }
    }

    /**
     * Writes to a smart contract.
     * By default, it returns the transaction hash without waiting for the receipt.
     * Use options.waitForReceipt = true to wait for confirmation.
     */
    async writeContract(
        chainId: number,
        privateKey: string,
        address: string,
        abi: readonly any[],
        functionName: string,
        args: any[] = [],
        options: ViemWriteContractOptions = {}
    ): Promise<Hash | TransactionReceipt> {
        const walletClient = this.getWalletClient(privateKey, chainId);

        try {
            const hash = await walletClient.writeContract({
                address: address as `0x${string}`,
                abi,
                functionName,
                args,
                value: options.value,
                gas: options.gas,
                type: 'eip1559',
            });

            this.logger.log(`Transaction sent: ${hash} (Chain: ${chainId}, Function: ${functionName})`);

            if (options.waitForReceipt) {
                const publicClient = this.getPublicClient(chainId);
                this.logger.debug(`Waiting for transaction receipt: ${hash}`);
                return await publicClient.waitForTransactionReceipt({ hash });
            }

            return hash;
        } catch (error) {
            this.logger.error(
                `Failed to write contract ${address} on chain ${chainId}, function ${functionName}: ${(error as Error).message}`
            );
            throw error;
        }
    }

    async waitForTransaction(chainId: number, hash: Hash): Promise<TransactionReceipt> {
        const client = this.getPublicClient(chainId);
        return await client.waitForTransactionReceipt({ hash });
    }

    async getTransactionReceipt(chainId: number, hash: Hash): Promise<TransactionReceipt> {
        const client = this.getPublicClient(chainId);
        try {
            return await client.getTransactionReceipt({ hash });
        } catch (error) {
            this.logger.error(
                `Failed to get transaction receipt for ${hash} on chain ${chainId}: ${(error as Error).message}`,
            );
            throw error;
        }
    }
}
