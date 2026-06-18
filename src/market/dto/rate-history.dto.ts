export class RateHistoryItemDto {
    date: string;
    rate: number;
}

export class RateHistoryDataDto {
    assetId: string;
    rateHistory: RateHistoryItemDto[];
}
