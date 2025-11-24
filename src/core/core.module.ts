import { Module } from "@nestjs/common";
import { DatabaseService } from "./database/database.service";
import { PrivyService } from "./privy/privy.service";
import { ViemService } from "./viem/viem.service";

@Module({
    imports: [],
    providers: [ViemService, DatabaseService, PrivyService],
    exports: [ViemService, DatabaseService, PrivyService],
})
export class CoreModule {}
