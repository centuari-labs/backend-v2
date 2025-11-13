import { Module } from "@nestjs/common";
import { DatabaseService } from "./database/database.service";
import { ViemService } from "./viem/viem.service";

@Module({
    imports: [],
    providers: [ViemService, DatabaseService],
    exports: [ViemService, DatabaseService],
})
export class CoreModule {}
