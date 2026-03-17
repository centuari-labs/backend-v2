import { IsOptional, IsUUID } from "class-validator";
import { Transform } from "class-transformer";
import type { AssetDto } from "../../common/dto/asset.dto";

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
}

export interface TransactionHistoryItem {
    id: string;
    side: string;
    orderType: string | null;
    rate: number;
    amount: string;
    filledQuantity: string | null;
    status: string;
    asset: AssetDto;
    fee: string | null;
    createdAt: string;
}
