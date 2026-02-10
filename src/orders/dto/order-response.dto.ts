import { HttpStatus } from "@nestjs/common";

export interface OrderResponseData {
    orderId: string;
    walletAddress: string;
    loanToken: string;
    maturities: number[];
    timestamp: number;
    side: string;
    type: string;
    status: string;
    originalAmount: string; 
    remainingAmount: string;
    settlementFeeAmount: string;
    /**
     * Interest rate expressed as a percentage (e.g. 5 = 5%).
     * Underlying value in the database is stored as basis points.
     */
    rate: number;
    transactionHash: string | null;
    blockNumber: number | null;
    createdAt: Date;
    updatedAt: Date;
    filledAt: Date | null;
    cancelledAt: Date | null;
}

export class OrderResponse {
    statusCode: HttpStatus;
    data: OrderResponseData;
}
