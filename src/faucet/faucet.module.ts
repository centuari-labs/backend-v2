import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CoreModule } from "../core/core.module";
import { Token } from "../tokens/entities/token.entity";
import { FaucetController } from "./faucet.controller";
import { FaucetService } from "./faucet.service";

@Module({
    imports: [CoreModule, ConfigModule, TypeOrmModule.forFeature([Token])],
    controllers: [FaucetController],
    providers: [FaucetService],
    exports: [FaucetService],
})
export class FaucetModule { }
