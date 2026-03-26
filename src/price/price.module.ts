import { Module, forwardRef } from "@nestjs/common";
import { TokensModule } from "../tokens/tokens.module";
import { CoreModule } from "../core/core.module";
import { PRICE_PROVIDER } from "./interfaces/price-provider.interface";
import { CoinGeckoProvider } from "./providers/coingecko.provider";
import { PriceService } from "./price.service";
import { PriceWorker } from "./price.worker";

@Module({
    imports: [TokensModule, forwardRef(() => CoreModule)],
    providers: [
        {
            provide: PRICE_PROVIDER,
            useClass: CoinGeckoProvider,
        },
        PriceService,
        PriceWorker,
    ],
    exports: [PriceService],
})
export class PriceModule {}
