export class RepayRequestDto {
    borrowerAddress: string;
    assetId: string;
    maturity: number;
    amount: string;
}

export interface RepayResponseDto {
    txHash: string;
    status: string;
}
