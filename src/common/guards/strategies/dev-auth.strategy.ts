import { Injectable, UnauthorizedException } from "@nestjs/common";
import type { AuthUser, IAuthStrategy } from "./auth-strategy.interface";

/**
 * Development-only auth strategy that accepts tokens in the format:
 *   DEV_TOKEN_<walletAddress>
 *
 * Only active when ENABLE_DEV_AUTH=true is set in the environment.
 */
@Injectable()
export class DevAuthStrategy implements IAuthStrategy {
    static readonly PREFIX = "DEV_TOKEN_";

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

    getName(): string {
        return "dev";
    }
}
