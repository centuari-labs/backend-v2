/** biome-ignore-all lint/suspicious/noExplicitAny: viem public client has complex generic recursion issues, so we use 'any' type here to avoid TypeScript compiler crashes.
 */

import { Injectable, Logger } from "@nestjs/common";
import { createPublicClient, http, isAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

@Injectable()
export class ViemService {
    private readonly logger = new Logger(ViemService.name);

    /**
     * viem public client has complex generic recursion issues,
     * so we use 'any' type here to avoid TypeScript compiler crashes.
     */
    private publicClient = new Map<any, any>();
    // private walletClients = new Map<string, any>();

    /**
     * Validates if a string is a valid Ethereum address
     */
    isValidAddress(address: string): boolean {
        return isAddress(address);
    }

    getClient(chainId: number): any {
        if (!this.publicClient.has(chainId)) {
            const client = createPublicClient({
                chain: base,
                transport: http(),
            });

            this.publicClient.set(chainId, client);
            this.logger.log(`Created new Viem client for chainId: ${chainId}`);
        }

        return this.publicClient.get(chainId);
    }

    /**
     * Generates a new wallet with address and private key
     */
    generateWallet(): { address: string; privateKey: string } {
        const privateKey = generatePrivateKey();
        const account = privateKeyToAccount(privateKey as `0x${string}`);

        this.logger.log(`Generated new wallet: ${account.address}`);

        return {
            address: account.address,
            privateKey,
        };
    }
}
