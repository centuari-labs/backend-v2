/** biome-ignore-all lint/suspicious/noExplicitAny: viem public client has complex generic recursion issues, so we use 'any' type here to avoid TypeScript compiler crashes.
 */

import { Injectable, Logger } from "@nestjs/common";
import { isAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

@Injectable()
export class ViemService {
    private readonly logger = new Logger(ViemService.name);

    /**
     * viem public client has complex generic recursion issues,
     * so we use 'any' type here to avoid TypeScript compiler crashes.
     */
    // private clients = new Map<any, any>();
    // private walletClients = new Map<string, any>();

    /**
     * Validates if a string is a valid Ethereum address
     */
    isValidAddress(address: string): boolean {
        return isAddress(address);
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
