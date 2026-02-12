import {
    IsArray,
    IsInt,
    IsNotEmpty,
    IsString,
    Max,
    Min,
    ArrayMinSize,
    IsBoolean,
    IsOptional,
} from "class-validator";
import {
    IsMinAmount,
    IsPositiveNumericString,
} from "../../common/validators/amount.validator";
import { IsValidMaturities } from "../../common/validators/maturity.validator";

export class CreateBorrowLimitOrderDto {
    @IsString()
    @IsNotEmpty()
    assetId: string;

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
    @IsValidMaturities({
        message:
            "Maturities must be on the 1st day of the next three calendar months (UTC).",
    })
    maturities: number[];

    @IsInt({ message: "Rate must be an integer" })
    @Min(1, { message: "Rate must be at least 1 basis point (0.01%)" })
    @Max(10000, { message: "Rate must not exceed 10000 basis points (100%)" })
    rate: number;

    @IsOptional()
    @IsBoolean()
    autoRollover?: boolean;
}


