import {
    IsString,
    IsNotEmpty,
    IsNumber,
    IsPositive,
    IsOptional,
    Min,
    IsInt,
} from "class-validator";

export class CreateLendMarketOrderDto {
    @IsString()
    @IsNotEmpty()
    wallet_address: string;

    @IsInt()
    @IsOptional()
    order_group_id?: number;

    @IsString()
    @IsNotEmpty()
    asset_address: string;

    @IsString()
    @IsNotEmpty()
    amount: string; // String to handle large numbers with decimals

    @IsNumber()
    @IsPositive()
    interest_rate: number; // Annual interest rate (e.g., 5.5 for 5.5%)

    @IsInt()
    @IsPositive()
    duration_days: number; // Loan duration in days
}
