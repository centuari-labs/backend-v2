import { IsOptional, IsEnum, IsDateString } from "class-validator";
import { Transform } from "class-transformer";
import { OrderSide, OrderStatus } from "../../orders/constants/order.constants";
import type { AssetDto } from "../../common/dto/asset.dto";

export class OpenOrdersQueryDto {
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

export interface OpenOrderItem {
    id: string;
    side: string;
    orderType: string | null;
    rate: number;
    amount: string;
    filledQuantity: string | null;
    status: string;
    maturity: string | null;
    asset: AssetDto;
    createdAt: string;
}

export interface RawOpenOrderRow {
    id: string;
    side: string;
    order_type: string | null;
    rate: string;
    amount: string;
    filled_quantity: string | null;
    status: string;
    asset_id: string;
    name: string;
    symbol: string;
    image_url: string | null;
    decimals: string;
    token_address: string;
    maturity: string | null;
    created_at: string;
}
