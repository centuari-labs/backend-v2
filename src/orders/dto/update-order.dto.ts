import {
    IsArray,
    IsBoolean,
    IsInt,
    IsNotEmpty,
    IsOptional,
    IsString,
    IsUUID,
    Max,
    Min,
    ArrayMinSize,
} from "class-validator";
import {
    IsMinAmount,
    IsPositiveNumericString,
} from "../../common/validators/amount.validator";

export class UpdateOrderDto {
    @IsString()
    @IsNotEmpty()
    @IsPositiveNumericString({
        message: "amount must be a valid positive number",
    })
    @IsMinAmount(1, { message: "amount must be at least 1 USD" })
    amount: string;

    /**
     * List of market IDs (UUIDs) this order targets.
     */
    @IsArray()
    @IsString({ each: true })
    @IsNotEmpty({ each: true })
    @IsUUID(undefined, { each: true })
    @ArrayMinSize(1, {
        message: "At least one marketId is required",
    })
    marketIds: string[];

    @IsInt({ message: "Rate must be an integer" })
    @Min(1, { message: "Rate must be at least 1 basis point (0.01%)" })
    @Max(10000, { message: "Rate must not exceed 10000 basis points (100%)" })
    rate: number;

    @IsOptional()
    @IsBoolean()
    autoRollover?: boolean;
}