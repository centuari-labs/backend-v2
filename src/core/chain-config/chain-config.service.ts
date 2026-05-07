import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class ChainConfigService {
    readonly chainId: number;
    readonly operatorPrivateKey: string;
    readonly treasuryAddress: string;
    readonly centuariAddress: string;
    readonly collateralManagerAddress: string;
    readonly riskModuleAddress: string;

    constructor(configService: ConfigService) {
        this.chainId = Number(
            configService.get<string>("DEPOSIT_CHAIN_ID") ?? "421614",
        );
        this.operatorPrivateKey =
            configService.get<string>("OPERATOR_PRIVATE_KEY") ?? "";
        this.treasuryAddress =
            configService.get<string>("TREASURY_ADDRESS") ?? "";
        this.centuariAddress =
            configService.get<string>("CENTUARI_ADDRESS") ?? "";
        this.collateralManagerAddress =
            configService.get<string>("COLLATERAL_MANAGER_ADDRESS") ?? "";
        this.riskModuleAddress =
            configService.get<string>("RISK_MODULE_ADDRESS") ?? "";
    }
}
