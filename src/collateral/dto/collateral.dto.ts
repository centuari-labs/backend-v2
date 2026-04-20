import { IsString, Matches } from "class-validator";

export class FlagCollateralDto {
    @IsString()
    @Matches(/^0x[a-fA-F0-9]{64}$/, { message: "invalid txHash" })
    txHash: string;

    @IsString()
    @Matches(/^0x[a-fA-F0-9]{40}$/, { message: "invalid asset address" })
    asset: string;
}

export class UnflagCollateralDto extends FlagCollateralDto {}

export interface CollateralMutationResponse {
    applied: boolean;
    reason?: string;
}
