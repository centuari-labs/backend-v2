import { IsOptional, IsIn, IsNumberString } from "class-validator";
import { Transform } from "class-transformer";

export class TransactionHistoryQueryDto {
    @IsOptional()
    @Transform(({ value }) => Number(value) || 1)
    page?: number = 1;

    @IsOptional()
    @Transform(({ value }) => Number(value) || 10)
    limit?: number = 10;

    @IsOptional()
    @IsIn(["MATCH", "ORDER"])
    type?: "MATCH" | "ORDER";
}

export interface TransactionHistoryItem {
    id: string;
    type: "MATCH" | "ORDER";
    side: string;
    orderType: string | null;
    rate: number;
    amount: string;
    filledQuantity: string | null;
    status: string;
    symbol: string;
    imageUrl: string | null;
    decimals: number;
    tokenAddress: string;
    maturity: number | null;
    fees: string | null;
    createdAt: string;
}
