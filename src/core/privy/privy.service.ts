/** biome-ignore-all lint/suspicious/noExplicitAny: viem public client has complex generic recursion issues, so we use 'any' type here to avoid TypeScript compiler crashes.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { PrivyClient } from "@privy-io/server-auth";
import * as jose from "jose";

@Injectable()
export class PrivyService {
    private readonly logger = new Logger(PrivyService.name);
    private privy: PrivyClient;
    private readonly verificationKey: string;

    constructor() {
        this.privy = new PrivyClient(
            process.env.PRIVY_APP_ID as string,
            process.env.PRIVY_PROJECT_SECRET as string,
        );

        this.verificationKey = readFileSync(
            join(
                __dirname,
                "..",
                "..",
                "..",
                "keys",
                "verificationKey.pub.key",
            ),
            "utf-8",
        );
    }

    async getVerificationKey() {
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

    async getUserInfo(accessToken: string, issuer: string, audience: string) {
        try {
            const verificationKey = await this.getVerificationKey();
            const payload = await jose.jwtVerify(accessToken, verificationKey, {
                issuer: issuer,
                audience: audience,
            });
            console.log(payload);

            // const user = await this.privy.getUser(userId);
            // return user;
        } catch (err) {
            this.logger.error(
                `Failed to fetch user info for userId: ${"a"}`,
                err as any,
            );
            throw new Error("Failed to fetch user info");
        }
    }
}
