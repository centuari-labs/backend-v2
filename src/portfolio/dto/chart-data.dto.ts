import { IsOptional } from "class-validator";
import { Transform } from "class-transformer";

export class ChartDataQueryDto {
    @IsOptional()
    @Transform(({ value }) => {
        const days = Number(value) || 90;
        return Math.min(Math.max(days, 1), 90);
    })
    days?: number = 90;
}

export interface ChartDataPoint {
    date: string;
    lendAmount: string;
    borrowAmount: string;
}
