/** biome-ignore-all lint/suspicious/noExplicitAny: viem public client has complex generic recursion issues, so we use 'any' type here to avoid TypeScript compiler crashes.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { PrivyClient } from "@privy-io/server-auth";
import * as jose from "jose";

@Injectable()
export class PrivyService {
    private readonly logger = new Logger(PrivyService.name);
    private privy: PrivyClient;
    private readonly verificationKey: string | null;

    constructor() {
        // Fail closed at boot: a misconfigured prod (e.g. testnet config bleed,
        // or a missing mainnet Privy app) must surface immediately, not as an
        // opaque runtime auth failure. PRIVY_APP_ID must match the frontend's
        // NEXT_PUBLIC_PRIVY_APP_ID — mainnet and testnet are separate Privy apps.
        const appId = process.env.PRIVY_APP_ID;
        const projectSecret = process.env.PRIVY_PROJECT_SECRET;
        if (!appId || !projectSecret) {
            throw new Error(
                "[privy] PRIVY_APP_ID and PRIVY_PROJECT_SECRET must both be set. Mainnet and testnet use separate Privy apps; PRIVY_APP_ID must equal the frontend NEXT_PUBLIC_PRIVY_APP_ID.",
            );
        }

        this.privy = new PrivyClient(appId, projectSecret);

        // Try to load verification key if it exists
        const keyPath = join(
            __dirname,
            "..",
            "..",
            "..",
            "keys",
            "verificationKeyPrivy.key.pub",
        );

        if (existsSync(keyPath)) {
            this.verificationKey = readFileSync(keyPath, "utf-8");
            this.logger.log("Verification key loaded successfully");
        } else {
            this.verificationKey = null;
            this.logger.warn(
                "Verification key not found at keys/verificationKey.pub.key - getUserInfo will not work",
            );
        }
    }

    async getVerificationKey() {
        if (!this.verificationKey) {
            throw new Error("Verification key is not configured");
        }
        const key = await jose.importSPKI(this.verificationKey, "ES256");
        return key;
    }

    async verify(token: string) {
        try {
            const result = await this.privy.verifyAuthToken(token);

            if (!result || !result.userId) {
                throw new UnauthorizedException("Invalid Privy Access Token");
            }

            return result;
        } catch (err) {
            console.error("Privy verification error:", err);
            throw new UnauthorizedException("Invalid Privy token");
        }
    }

    async getUser(userId: string) {
        try {
            return await this.privy.getUser(userId);
        } catch (error) {
            this.logger.error(
                `Failed to fetch user ${userId}: ${(error as Error).message}`,
            );
            throw error;
        }
    }
}
