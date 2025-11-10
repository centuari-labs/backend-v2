/** biome-ignore-all lint/suspicious/noExplicitAny: viem public client has complex generic recursion issues, so we use 'any' type here to avoid TypeScript compiler crashes.
 */

import { Injectable, Logger } from "@nestjs/common";

@Injectable()
export class ViemService {
    private readonly logger = new Logger(ViemService.name);

    /**
     * viem public client has complex generic recursion issues,
     * so we use 'any' type here to avoid TypeScript compiler crashes.
     */
    private clients = new Map<any, any>();
    private walletClients = new Map<string, any>();
}
