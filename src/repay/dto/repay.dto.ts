import { IsNotEmpty, IsString, IsUUID } from "class-validator";

export class RepayRequestDto {
    @IsUUID()
    @IsNotEmpty()
    marketId: string;

    @IsString()
    @IsNotEmpty()
    amount: string;
}

export interface RepayResponseDto {
    txHash: string;
    status: string;
}
