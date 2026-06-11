import { Injectable, UnauthorizedException } from "@nestjs/common";
import type {
    AuthPrincipal,
    AuthUser,
    IAuthStrategy,
} from "./auth-strategy.interface";

/**
 * Development-only auth strategy that accepts tokens in the format:
 *   DEV_TOKEN_<walletAddress>
 *
 * Only active when ENABLE_DEV_AUTH=true is set in the environment.
 */
@Injectable()
export class DevAuthStrategy implements IAuthStrategy {
    static readonly PREFIX = "DEV_TOKEN_";

    constructor() {
        // Hard fail-closed: dev-auth bypasses Privy verification entirely
        // (any DEV_TOKEN_<addr> becomes that wallet). It must never be
        // instantiable in production, even if ENABLE_DEV_AUTH is misconfigured.
        if (process.env.NODE_ENV === "production") {
            throw new Error(
                "DevAuthStrategy must never be enabled in production. " +
                    "Unset ENABLE_DEV_AUTH or fix NODE_ENV.",
            );
        }
    }

    static isDevToken(token: string): boolean {
        return token.startsWith(DevAuthStrategy.PREFIX);
    }

    async validate(token: string): Promise<AuthUser> {
        if (!DevAuthStrategy.isDevToken(token)) {
            throw new UnauthorizedException("Invalid dev token format");
        }

        const walletAddress = token.slice(DevAuthStrategy.PREFIX.length);

        if (!walletAddress || !walletAddress.startsWith("0x")) {
            throw new UnauthorizedException(
                "Dev token must contain a valid wallet address",
            );
        }

        return {
            userId: `dev-user-${walletAddress.toLowerCase()}`,
            walletAddress,
        };
    }

    // Dev validation is fully local, so both stages reuse validate().
    async verifyPrincipal(token: string): Promise<AuthPrincipal> {
        const user = await this.validate(token);
        return { userId: user.userId };
    }

    async resolveAuthUser(token: string): Promise<AuthUser> {
        return this.validate(token);
    }

    getName(): string {
        return "dev";
    }
}
