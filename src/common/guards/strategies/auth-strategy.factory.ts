import { Injectable, Logger } from "@nestjs/common";
import type { IAuthStrategy } from "./auth-strategy.interface";
import { PrivyAuthStrategy } from "./privy-auth.strategy";

@Injectable()
export class AuthStrategyFactory {
    private readonly logger = new Logger(AuthStrategyFactory.name);

    constructor(private readonly privyStrategy: PrivyAuthStrategy) {
        this.logger.log("Auth strategy: Privy");
    }

    getStrategy(): IAuthStrategy {
        return this.privyStrategy;
    }
}
