import { Injectable, Logger } from "@nestjs/common";
import type { IAuthStrategy } from "./auth-strategy.interface";
import { PrivyAuthStrategy } from "./privy-auth.strategy";
import { DevAuthStrategy } from "./dev-auth.strategy";

@Injectable()
export class AuthStrategyFactory {
    private readonly logger = new Logger(AuthStrategyFactory.name);
    private readonly devStrategy: DevAuthStrategy | null;

    constructor(private readonly privyStrategy: PrivyAuthStrategy) {
        if (process.env.ENABLE_DEV_AUTH === "true") {
            this.devStrategy = new DevAuthStrategy();
            this.logger.warn(
                "Dev auth strategy ENABLED — do not use in production",
            );
        } else {
            this.devStrategy = null;
        }
        this.logger.log("Auth strategy: Privy");
    }

    getStrategy(token?: string): IAuthStrategy {
        if (this.devStrategy && token && DevAuthStrategy.isDevToken(token)) {
            return this.devStrategy;
        }
        return this.privyStrategy;
    }
}
