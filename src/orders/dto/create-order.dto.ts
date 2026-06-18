import {
    ArrayMinSize,
    IsArray,
    IsBoolean,
    IsInt,
    IsNotEmpty,
    IsOptional,
    IsString,
    Max,
    Min,
} from "class-validator";
import {
    IsMinAmount,
    IsPositiveNumericString,
} from "../../common/validators/amount.validator";
import { IsBytes32Hex } from "../../common/validators/bytes32-hex.validator";

export class BaseCreateOrderDto {
    @IsString()
    @IsNotEmpty()
    assetId: string;

    @IsString()
    @IsNotEmpty()
    @IsPositiveNumericString({
        message: "amount must be a valid positive number",
    })
    @IsMinAmount(10, { message: "amount must be at least 10 USD" })
    amount: string;

    /**
     * List of market IDs (bytes32 hex, `0x` + 64 hex chars) this order targets.
     * Each ID is the `market.market_id` BYTEA value from the indexer-v3 schema.
     */
    @IsArray()
    @IsString({ each: true })
    @IsNotEmpty({ each: true })
    @IsBytes32Hex({ each: true })
    @ArrayMinSize(1, {
        message: "At least one marketId is required",
    })
    marketIds: string[];

    @IsOptional()
    @IsBoolean()
    autoRollover?: boolean;
}

export class CreateMarketOrderDto extends BaseCreateOrderDto {}

export class CreateLimitOrderDto extends BaseCreateOrderDto {
    @IsInt({ message: "Rate must be an integer" })
    @Min(1, { message: "Rate must be at least 1 basis point (0.01%)" })
    @Max(10000, {
        message: "Rate must not exceed 10000 basis points (100%)",
    })
    rate: number;
}
