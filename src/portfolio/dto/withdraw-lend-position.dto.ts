import { IsUUID } from "class-validator";

export class WithdrawLendPositionDto {
    @IsUUID()
    positionId: string;
}

export class WithdrawLendPositionResponseDto {
    txHash: string;
    status: string;
}
