import { Module } from "@nestjs/common";
import { DatabaseService } from "./database/database.service";
import { ViemService } from "./viem/viem.service";
import { NatsService } from "./nats/nats.service";

@Module({
    providers: [ViemService, DatabaseService, NatsService],
    exports: [ViemService, DatabaseService, NatsService],
})
export class CoreModule {}
