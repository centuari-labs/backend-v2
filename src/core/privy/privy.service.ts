/** biome-ignore-all lint/suspicious/noExplicitAny: viem public client has complex generic recursion issues, so we use 'any' type here to avoid TypeScript compiler crashes.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
    Injectable,
    Logger,
    type OnModuleInit,
    UnauthorizedException,
} from "@nestjs/common";
import { PrivyClient } from "@privy-io/server-auth";
import * as jose from "jose";

@Injectable()
export class PrivyService implements OnModuleInit {
    private readonly logger = new Logger(PrivyService.name);
    private privy: PrivyClient;
    private readonly verificationKey: string | null;
    // One-way switch: flips when the local key file is proven stale (a token
    // it rejected verified fine via the SDK-fetched key).
    private localKeyStale = false;

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

    /**
     * Best-effort, NON-BLOCKING pre-warm of the SDK's verification-key fetch.
     * The SDK only caches the key on a SUCCESSFUL fetch — a failed fetch is
     * retried on every verifyAuthToken call. When no local key file is
     * present, kick off the one-time fetch at boot so the first real request
     * doesn't pay the network round-trip. Deliberately not awaited: Nest
     * blocks bootstrap on onModuleInit, and a hanging Privy endpoint must not
     * stall deploys or fire blocking network calls in test bootstraps.
     */
    onModuleInit() {
        if (this.verificationKey) {
            return;
        }
        // Structurally valid JWT so the SDK reaches the key-fetch step;
        // verification itself is expected to fail and is ignored.
        void this.privy
            .verifyAuthToken(
                "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjB9.AA",
            )
            .catch(() => {
                // Expected — the dummy token never verifies. Key fetch (if it
                // succeeded) is now cached inside the SDK client.
            });
    }

    async verify(token: string) {
        try {
            const result = await this.verifyWithBestKey(token);

            if (!result || !result.userId) {
                throw new UnauthorizedException("Invalid Privy Access Token");
            }

            return result;
        } catch (err) {
            // debug, not error: this fires for every garbage-but-JWT-shaped
            // token the throttler tracker sees. AuthGuard already logs a warn
            // for real auth failures.
            this.logger.debug(
                `Privy verification error: ${
                    err instanceof Error ? err.message : String(err)
                }`,
            );
            throw new UnauthorizedException("Invalid Privy token");
        }
    }

    /**
     * Prefer the locally-loaded verification key (pure local crypto, no
     * network) but never trust it blindly: the committed key file can go
     * stale (Privy key rotation, mainnet/testnet app switch). If local
     * verification fails but the SDK-fetched key verifies the same token,
     * the file is wrong — stop using it for the rest of the process and say
     * so loudly, instead of 401-ing the whole fleet with no self-heal.
     */
    private async verifyWithBestKey(token: string) {
        if (this.verificationKey && !this.localKeyStale) {
            try {
                return await this.privy.verifyAuthToken(
                    token,
                    this.verificationKey,
                );
            } catch {
                const result = await this.privy.verifyAuthToken(token);
                // Only reached when the fetched key verified what the local
                // key rejected — the local file is stale.
                this.localKeyStale = true;
                this.logger.error(
                    "Local Privy verification key is stale or mismatched " +
                        "(token verified via SDK-fetched key). Refresh " +
                        "keys/verificationKeyPrivy.key.pub.",
                );
                return result;
            }
        }
        return this.privy.verifyAuthToken(token);
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
