import { IsNotEmpty, IsString, IsUUID } from "class-validator";
import { IsPositiveNumericString } from "../../common/validators/amount.validator";

export class WithdrawRequestDto {
    @IsUUID()
    assetId: string;

    @IsString()
    @IsNotEmpty()
    @IsPositiveNumericString()
    amount: string; // human-readable token units (e.g. "100.5")
}

export interface WithdrawResponseDto {
    txHash: string;
    status: string;
}
