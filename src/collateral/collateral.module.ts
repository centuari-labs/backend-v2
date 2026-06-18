import { Module } from "@nestjs/common";
import { CoreModule } from "../core/core.module";
import { CollateralController } from "./collateral.controller";
import { CollateralService } from "./collateral.service";
import { CollateralOnChainRepository } from "./repositories/collateral-on-chain.repository";
import { PendingCollateralFlagsRepository } from "./repositories/pending-collateral-flags.repository";

@Module({
    imports: [CoreModule],
    controllers: [CollateralController],
    providers: [
        CollateralService,
        CollateralOnChainRepository,
        PendingCollateralFlagsRepository,
    ],
})
export class CollateralModule {}
