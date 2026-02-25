import { IsNotEmpty, IsUUID } from "class-validator";

export class RateHistoryQueryDto {
    @IsNotEmpty()
    @IsUUID()
    assetId: string;
}

export class RateHistoryItemDto {
    date: string;
    rate: number;
}

export class RateHistoryDataDto {
    assetId: string;
    rateHistory: RateHistoryItemDto[];
}

export class RateHistoryResponseDto {
    statusCode: number;
    data: RateHistoryDataDto;
}