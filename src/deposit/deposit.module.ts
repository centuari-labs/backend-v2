import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CoreModule } from "../core/core.module";
import { TokensModule } from "../tokens/tokens.module";
import { DepositController } from "./deposit.controller";
import { DepositService } from "./deposit.service";
import { DepositTransaction } from "./entities/deposit-transaction.entity";

@Module({
    imports: [
        CoreModule,
        ConfigModule,
        TokensModule,
        TypeOrmModule.forFeature([DepositTransaction]),
    ],
    controllers: [DepositController],
    providers: [DepositService],
})
export class DepositModule {}
