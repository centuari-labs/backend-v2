import {
    ArrayMinSize,
    IsArray,
    IsInt,
    IsNotEmpty,
    IsString,
    Min,
} from "class-validator";
import {
    IsMinAmount,
    IsPositiveNumericString,
} from "../../common/validators/amount.validator";

export class CreateLendMarketOrderDto {
    @IsString()
    @IsNotEmpty()
    loanToken: string;

    @IsString()
    @IsNotEmpty()
    @IsPositiveNumericString({
        message: "amount must be a valid positive number",
    })
    @IsMinAmount(1, { message: "amount must be at least 1 USD" })
    amount: string;

    @IsArray()
    @IsInt({ each: true })
    @Min(1, { each: true, message: "Maturity must be a positive integer" })
    @ArrayMinSize(1, { message: "At least one maturity date is required" })
    maturities: number[];
}


