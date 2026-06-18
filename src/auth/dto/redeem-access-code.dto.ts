import { IsString, IsNotEmpty } from "class-validator";

export class RedeemAccessCodeDto {
    @IsString()
    @IsNotEmpty()
    code: string;
}
