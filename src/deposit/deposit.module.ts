import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { CoreModule } from "../core/core.module";
import { TokensModule } from "../tokens/tokens.module";
import { ChainIndexerModule } from "../chain-indexer/chain-indexer.module";
import { DepositController } from "./deposit.controller";
import { DepositService } from "./deposit.service";

@Module({
    imports: [CoreModule, ConfigModule, TokensModule, ChainIndexerModule],
    controllers: [DepositController],
    providers: [DepositService],
})
export class DepositModule {}
