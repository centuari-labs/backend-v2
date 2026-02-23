import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { CoreModule } from "../core/core.module";
import { FaucetController } from "./faucet.controller";
import { FaucetService } from "./faucet.service";

@Module({
    imports: [CoreModule, ConfigModule],
    controllers: [FaucetController],
    providers: [FaucetService],
    exports: [FaucetService],
})
export class FaucetModule { }
