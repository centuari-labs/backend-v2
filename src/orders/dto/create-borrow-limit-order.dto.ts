import {
    IsString,
    IsNotEmpty,
    IsNumber,
    IsPositive,
    IsArray,
    IsDateString,
    ArrayMinSize,
    IsOptional,
} from "class-validator";
import { IsMinAmount, IsPositiveNumericString } from "../../common/validators/amount.validator";

export class CreateBorrowLimitOrderDto {
    @IsString()
    @IsNotEmpty()
    loanToken: string;

    @IsString()
    @IsNotEmpty()
    @IsPositiveNumericString({ message: "amount must be a valid positive number" })
    @IsMinAmount(1, { message: "amount must be at least 1 USD" })
    amount: string;

    @IsOptional()
    @IsArray()
    @ArrayMinSize(1)
    @IsString({ each: true })
    collateralAddress?: string[];

    @IsOptional()
    @IsArray()
    @ArrayMinSize(1)
    @IsString({ each: true })
    @IsPositiveNumericString({ each: true, message: "each collateralAmount must be a valid positive number" })
    collateralAmount?: string[];

    @IsNumber()
    @IsPositive()
    interestRate: number;

    @IsArray()
    @ArrayMinSize(1)
    @IsDateString({}, { each: true })
    dates: string[];
}
