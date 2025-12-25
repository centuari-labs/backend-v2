import {
    IsString,
    IsNotEmpty,
    IsNumber,
    IsPositive,
    IsArray,
    IsDateString,
    ArrayMinSize,
} from "class-validator";
import { IsMinAmount, IsPositiveNumericString } from "../../common/validators/amount.validator";

export class CreateLendLimitOrderDto {
    @IsString()
    @IsNotEmpty()
    loanToken: string;

    @IsString()
    @IsNotEmpty()
    @IsPositiveNumericString({ message: "amount must be a valid positive number" })
    @IsMinAmount(1, { message: "amount must be at least 1 USD" })
    amount: string;

    @IsNumber()
    @IsPositive()
    interestRate: number;

    @IsArray()
    @ArrayMinSize(1)
    @IsDateString({}, { each: true })
    dates: string[];
}
