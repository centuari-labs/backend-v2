import { Module } from "@nestjs/common";
import { ViemService } from "./viem/viem.service";

@Module({
    imports: [],
    providers: [ViemService],
    exports: [ViemService],
})
export class CoreModule {}
