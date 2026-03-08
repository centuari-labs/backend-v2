import { IsNotEmpty, IsString, IsUUID } from "class-validator";

export class WithdrawRequestDto {
    @IsUUID()
    assetId: string;

    @IsString()
    @IsNotEmpty()
    amount: string; // human-readable token units (e.g. "100.5")
}

export interface WithdrawResponseDto {
    txHash: string;
    status: string;
}
