import { Injectable, Logger } from "@nestjs/common";
import type { IAuthStrategy } from "./auth-strategy.interface";
import { PrivyAuthStrategy } from "./privy-auth.strategy";
import { DevAuthStrategy } from "./dev-auth.strategy";

@Injectable()
export class AuthStrategyFactory {
    private readonly logger = new Logger(AuthStrategyFactory.name);
    private readonly isDev: boolean;

    constructor(
        private readonly privyStrategy: PrivyAuthStrategy,
        private readonly devStrategy: DevAuthStrategy,
    ) {
        this.isDev = process.env.AUTH_MODE === "development";

        if (this.isDev) {
            this.logger.warn("⚠️  AUTH IN DEV MODE (AUTH_MODE=development)");
        } else {
            this.logger.log("⚠️ AUTH IN PRODUCTION MODE (NODE_ENV=production)");
        }
    }

    getStrategy(): IAuthStrategy {
        return this.isDev
            ? this.devStrategy
            : this.privyStrategy;
    }
}
