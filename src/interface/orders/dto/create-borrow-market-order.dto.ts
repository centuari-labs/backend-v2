import {
    IsString,
    IsNotEmpty,
    IsNumber,
    IsPositive,
    IsOptional,
    IsInt,
} from "class-validator";

export class CreateBorrowMarketOrderDto {
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
    interest_rate: number; // Annual interest rate willing to pay

    @IsInt()
    @IsPositive()
    duration_days: number; // Loan duration in days

    @IsString()
    @IsNotEmpty()
    collateral_asset_address: string; // Collateral token address

    @IsString()
    @IsNotEmpty()
    collateral_amount: string; // Collateral amount

    @IsNumber()
    @IsPositive()
    collateral_ratio: number; // Collateralization ratio (e.g., 150.0 for 150%)
}
