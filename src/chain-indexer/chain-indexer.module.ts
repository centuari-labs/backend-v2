import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CoreModule } from "../core/core.module";
import { PortfolioModule } from "../portfolio/portfolio.module";
import { ChainIndexerService } from "./chain-indexer.service";
import { Account } from "../orders/entities/account.entity";
import { Token } from "../tokens/entities/token.entity";

@Module({
    imports: [
        CoreModule,
        PortfolioModule,
        TypeOrmModule.forFeature([Account, Token]),
    ],
    providers: [ChainIndexerService],
    exports: [ChainIndexerService],
})
export class ChainIndexerModule {}
