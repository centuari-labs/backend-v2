import { Module, forwardRef } from "@nestjs/common";
import { DatabaseService } from "./database/database.service";
import { NatsService } from "./nats/nats.service";
import { PrivyService } from "./privy/privy.service";
import { ViemService } from "./viem/viem.service";
import { ChainConfigService } from "./chain-config/chain-config.service";
import { RedisService } from "./redis/redis.service";
import { RedisRateLimiterService } from "../common/rate-limit/redis-rate-limiter.service";
import { AuthGuard } from "../common/guards/auth.guard";
import { AuthStrategyFactory } from "../common/guards/strategies/auth-strategy.factory";
import { PrivyAuthStrategy } from "../common/guards/strategies/privy-auth.strategy";
import { EventsGateway } from "./websocket/websocket.gateway";
import { OrdersModule } from "../orders/orders.module";

@Module({
    imports: [forwardRef(() => OrdersModule)],
    exports: [
        ViemService,
        DatabaseService,
        PrivyService,
        NatsService,
        ChainConfigService,
        RedisService,
        RedisRateLimiterService,
        AuthGuard,
        AuthStrategyFactory,
        PrivyAuthStrategy,
        EventsGateway,
    ],
    providers: [
        ViemService,
        DatabaseService,
        PrivyService,
        NatsService,
        ChainConfigService,
        RedisService,
        RedisRateLimiterService,
        AuthGuard,
        AuthStrategyFactory,
        PrivyAuthStrategy,
        EventsGateway,
    ],
})
export class CoreModule {}
