import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class ChainConfigService {
    private readonly logger = new Logger(ChainConfigService.name);
    readonly chainId: number;
    readonly operatorPrivateKey: string;
    /**
     * Dedicated signing key for the oracle price-push keeper. Falls back to
     * `operatorPrivateKey` so it works with the same key today; set
     * `ORACLE_PUSH_OPERATOR_PRIVATE_KEY` to point the keeper at a separate
     * operator later (then also rotate the PushOracles' on-chain operator to
     * that address via `PushOracle.setOperator`).
     */
    readonly oraclePushOperatorPrivateKey: string;
    readonly hubDepositorAddress: string;
    readonly centuariAddress: string;
    readonly collateralManagerAddress: string;
    readonly riskModuleAddress: string;
    readonly balanceLedgerAddress: string;
    readonly withdrawalRegistryAddress: string;
    readonly withdrawViaRegistry: boolean;
    /** Per-token PushOracle addresses ({symbol: address}) from synced PUSH_ORACLES_JSON. */
    readonly pushOracles: Record<string, string>;

    constructor(configService: ConfigService) {
        this.chainId = Number(
            configService.get<string>("DEPOSIT_CHAIN_ID") ?? "421614",
        );
        this.operatorPrivateKey =
            configService.get<string>("OPERATOR_PRIVATE_KEY") ?? "";
        this.oraclePushOperatorPrivateKey =
            configService.get<string>("ORACLE_PUSH_OPERATOR_PRIVATE_KEY") ??
            this.operatorPrivateKey;
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
        this.pushOracles = this.parsePushOracles(
            configService.get<string>("PUSH_ORACLES_JSON"),
        );
    }

    /**
     * Parse the synced PUSH_ORACLES_JSON ({symbol: address}). Returns an empty
     * map (price keeper no-ops) when absent or malformed.
     */
    private parsePushOracles(raw?: string): Record<string, string> {
        if (!raw) return {};
        try {
            const parsed = JSON.parse(raw);
            if (
                parsed &&
                typeof parsed === "object" &&
                !Array.isArray(parsed)
            ) {
                return parsed as Record<string, string>;
            }
        } catch (error) {
            this.logger.warn(
                `Invalid PUSH_ORACLES_JSON; oracle price keeper disabled: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        }
        return {};
    }
}
