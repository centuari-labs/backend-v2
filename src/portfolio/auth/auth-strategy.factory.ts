import { Injectable, Logger } from "@nestjs/common";
import type { IAuthStrategy } from "./strategies/auth-strategy.interface";
import { PrivyAuthStrategy } from "./strategies/privy-auth.strategy";
import { DevAuthStrategy } from "./strategies/dev-auth.strategy";

@Injectable()
export class PortfolioAuthStrategyFactory {
    private readonly logger = new Logger(PortfolioAuthStrategyFactory.name);
    private readonly isDev: boolean;

    constructor(
        private readonly privyStrategy: PrivyAuthStrategy,
        private readonly devStrategy: DevAuthStrategy,
    ) {
        this.isDev = process.env.AUTH_MODE === "development";

        if (this.isDev) {
            this.logger.warn("⚠️  PORTFOLIO AUTH IN DEV MODE (AUTH_MODE=development)");
        }
    }

    getStrategy(): IAuthStrategy {
        return this.isDev
            ? this.devStrategy
            : this.privyStrategy;
    }
}
