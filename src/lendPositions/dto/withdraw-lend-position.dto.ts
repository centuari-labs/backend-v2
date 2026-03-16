import { IsUUID } from "class-validator";

export class WithdrawLendPositionDto {
    @IsUUID()
    marketId: string;
}

export class WithdrawLendPositionResponseDto {
    txHash: string;
    status: string;
}
