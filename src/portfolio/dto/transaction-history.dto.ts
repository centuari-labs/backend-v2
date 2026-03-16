import { IsOptional } from "class-validator";
import { Transform } from "class-transformer";

export class TransactionHistoryQueryDto {
    @IsOptional()
    @Transform(({ value }) => Number(value) || 1)
    page?: number = 1;

    @IsOptional()
    @Transform(({ value }) => Number(value) || 10)
    limit?: number = 10;
}

export interface TransactionHistoryItem {
    id: string;
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
    createdAt: string;
}
