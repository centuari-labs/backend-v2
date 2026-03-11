import { IsNotEmpty, IsString, IsUUID } from "class-validator";

export class RepayRequestDto {
    @IsUUID()
    assetId: string;

    @IsString()
    @IsNotEmpty()
    amount: string; // human-readable token units (e.g. "100.5")
}

export interface RepayResponseDto {
    txHash: string;
    status: string;
}
