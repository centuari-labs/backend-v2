import { Module } from "@nestjs/common";
import { DatabaseService } from "./database/database.service";
import { NatsService } from "./nats/nats.service";
import { PrivyService } from "./privy/privy.service";
import { ViemService } from "./viem/viem.service";
import { AuthGuard } from "../common/guards/auth.guard";
import { AuthStrategyFactory } from "../common/guards/strategies/auth-strategy.factory";
import { PrivyAuthStrategy } from "../common/guards/strategies/privy-auth.strategy";
import { DevAuthStrategy } from "../common/guards/strategies/dev-auth.strategy";

@Module({
    imports: [],
    exports: [
        ViemService,
        DatabaseService,
        PrivyService,
        NatsService,
        AuthGuard,
        AuthStrategyFactory,
        PrivyAuthStrategy,
        DevAuthStrategy,
    ],
    providers: [
        ViemService,
        DatabaseService,
        PrivyService,
        NatsService,
        AuthGuard,
        AuthStrategyFactory,
        PrivyAuthStrategy,
        DevAuthStrategy,
    ],
})
export class CoreModule { }
