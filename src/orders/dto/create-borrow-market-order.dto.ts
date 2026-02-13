import {
    ArrayMinSize,
    IsArray,
    IsNotEmpty,
    IsString,
    IsBoolean,
    IsOptional,
    IsUUID,
} from "class-validator";
import {
    IsMinAmount,
    IsPositiveNumericString,
} from "../../common/validators/amount.validator";
export class CreateBorrowMarketOrderDto {
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
     * List of market IDs (UUIDs) this order targets.
     * Each ID references the `markets.id` column.
     */
    @IsArray()
    @IsString({ each: true })
    @IsNotEmpty({ each: true })
    @IsUUID(undefined, { each: true })
    @ArrayMinSize(1, {
        message: "At least one marketId is required",
    })
    marketIds: string[];

    @IsOptional()
    @IsBoolean()
    autoRollover?: boolean;
}


