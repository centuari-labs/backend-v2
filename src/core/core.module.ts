import { Module } from "@nestjs/common";
import { DatabaseService } from "./database/database.service";
import { NatsService } from "./nats/nats.service";
import { PrivyService } from "./privy/privy.service";
import { ViemService } from "./viem/viem.service";

@Module({
    imports: [],
    exports: [ViemService, DatabaseService, PrivyService, NatsService],
    providers: [ViemService, DatabaseService, PrivyService, NatsService],
})
export class CoreModule {}
