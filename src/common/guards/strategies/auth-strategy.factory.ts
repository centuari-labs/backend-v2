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
        this.isDev = process.env.NODE_ENV !== "production";

        if (this.isDev) {
            this.logger.warn(
                `⚠️  AUTH IN DEV MODE (NODE_ENV=${process.env.NODE_ENV ?? "undefined"})`,
            );
        } else {
            this.logger.log("AUTH IN PRODUCTION MODE");
        }
    }

    getStrategy(): IAuthStrategy {
        return this.isDev ? this.devStrategy : this.privyStrategy;
    }
}
