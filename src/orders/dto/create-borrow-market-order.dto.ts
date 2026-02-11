import {
    ArrayMinSize,
    IsArray,
    IsInt,
    IsNotEmpty,
    IsString,
    Min,
    IsBoolean,
    IsOptional,
} from "class-validator";
import {
    IsMinAmount,
    IsPositiveNumericString,
} from "../../common/validators/amount.validator";

export class CreateBorrowMarketOrderDto {
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

    /**
     * List of market maturities as Unix timestamps (seconds).
     */
    @IsArray()
    @IsInt({ each: true })
    @Min(1, {
        each: true,
        message: "Maturity must be a positive Unix timestamp in seconds",
    })
    @ArrayMinSize(1, {
        message: "At least one maturity timestamp is required",
    })
    maturities: number[];

    @IsOptional()
    @IsBoolean()
    autoRollover?: boolean;
}


