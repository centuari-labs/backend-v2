import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class ChainConfigService {
    readonly chainId: number;
    readonly operatorPrivateKey: string;
    readonly treasuryAddress: string;
    readonly centuariAddress: string;

    constructor(private readonly configService: ConfigService) {
        this.chainId = Number(
            configService.get<string>("DEPOSIT_CHAIN_ID") ?? "421614",
        );
        this.operatorPrivateKey =
            configService.get<string>("OPERATOR_PRIVATE_KEY") ?? "";
        this.treasuryAddress =
            configService.get<string>("TREASURY_ADDRESS") ?? "";
        this.centuariAddress =
            configService.get<string>("CENTUARI_ADDRESS") ?? "";
    }
}
