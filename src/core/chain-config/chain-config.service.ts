import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class ChainConfigService {
    readonly chainId: number;
    readonly operatorPrivateKey: string;
    readonly hubDepositorAddress: string;
    readonly centuariAddress: string;
    readonly collateralManagerAddress: string;
    readonly riskModuleAddress: string;
    readonly balanceLedgerAddress: string;
    readonly withdrawalRegistryAddress: string;
    readonly withdrawViaRegistry: boolean;

    constructor(configService: ConfigService) {
        this.chainId = Number(
            configService.get<string>("DEPOSIT_CHAIN_ID") ?? "421614",
        );
        this.operatorPrivateKey =
            configService.get<string>("OPERATOR_PRIVATE_KEY") ?? "";
        this.hubDepositorAddress =
            configService.get<string>("HUB_DEPOSITOR_ADDRESS") ?? "";
        this.centuariAddress =
            configService.get<string>("CENTUARI_ADDRESS") ?? "";
        this.collateralManagerAddress =
            configService.get<string>("COLLATERAL_MANAGER_ADDRESS") ?? "";
        this.riskModuleAddress =
            configService.get<string>("RISK_MODULE_ADDRESS") ?? "";
        this.balanceLedgerAddress =
            configService.get<string>("BALANCE_LEDGER_ADDRESS") ?? "";
        this.withdrawalRegistryAddress =
            configService.get<string>("WITHDRAWAL_REGISTRY_ADDRESS") ?? "";
        this.withdrawViaRegistry =
            (
                configService.get<string>("WITHDRAW_VIA_REGISTRY") ?? "false"
            ).toLowerCase() === "true";
    }
}
