import { IsOptional, IsUUID, IsEnum, IsDateString } from "class-validator";
import { Transform } from "class-transformer";
import type { AssetDto } from "../../common/dto/asset.dto";
import { OrderSide, OrderStatus } from "../../orders/constants/order.constants";

export class OrderHistoryQueryDto {
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
    @IsEnum(OrderStatus)
    status?: OrderStatus;

    @IsOptional()
    @IsDateString()
    startDate?: string;

    @IsOptional()
    @IsDateString()
    endDate?: string;
}

export interface OrderHistoryItem {
    id: string;
    side: string;
    orderType: string | null;
    rate: number;
    amount: string;
    filledQuantity: string | null;
    status: string;
    cancelReason: string | null;
    asset: AssetDto;
    fee: string | null;
    createdAt: string;
    maturity: string | null;
}
