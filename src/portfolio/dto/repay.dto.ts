import { IsNotEmpty, IsString } from "class-validator";
import { IsBytes32Hex } from "../../common/validators/bytes32-hex.validator";

export class RepayRequestDto {
    @IsBytes32Hex()
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
