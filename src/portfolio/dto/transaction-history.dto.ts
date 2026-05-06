import { IsOptional, IsUUID, IsEnum, IsDateString } from "class-validator";
import { Transform } from "class-transformer";
import { OrderSide } from "../../orders/constants/order.constants";

export class TransactionHistoryQueryDto {
    @IsOptional()
    @IsUUID()
    assetId?: string;

    @IsOptional()
    @Transform(({ value }) => Number(value) || 1)
    page?: number = 1;

    @IsOptional()
    @Transform(({ value }) => Number(value) || 10)
    limit?: number = 10;

    @IsOptional()
    @IsEnum(OrderSide)
    side?: OrderSide;

    @IsOptional()
    @IsDateString()
    startDate?: string;

    @IsOptional()
    @IsDateString()
    endDate?: string;
}

export interface TransactionHistoryItem {
    id: string;
    side: string;
    rate: number;
    amount: string;
    fee: string | null;
    assetId: string;
    maturity: string;
    createdAt: string;
}
