import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import type { AuthUser, IAuthStrategy } from "./auth-strategy.interface";

@Injectable()
export class DevAuthStrategy implements IAuthStrategy {
    private readonly logger = new Logger(DevAuthStrategy.name);

    async validate(token: string): Promise<AuthUser> {
        if (token.startsWith("DEV_TOKEN_")) {
            const wallet = token.replace("DEV_TOKEN_", "");

            if (!wallet) {
                throw new UnauthorizedException("Dev token must include wallet address");
            }

            this.logger.warn(`[Auth] Dev mode: ${wallet}`);

            return {
                userId: `dev-user-${wallet}`,
                walletAddress: wallet,
            };
        }

        throw new UnauthorizedException("Invalid dev token format");
    }

    getName(): string {
        return "dev";
    }
}
