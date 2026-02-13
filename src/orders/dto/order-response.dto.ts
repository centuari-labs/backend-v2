import { HttpStatus } from "@nestjs/common";
import { OrderSide, OrderStatus, OrderType } from "../constants/order.constants";

export interface OrderResponseData {
    orderId: string;
    walletAddress: string;
    assetId: string;
    /**
     * Maturities for the order as Unix timestamps (seconds).
     */
    maturities: number[]; //@todo : should be maturities from market table
    timestamp: number;
    side: OrderSide;
    type: OrderType;
    status: OrderStatus;
    originalAmount: string; 
    settlementFeeAmount: string;
    autoRollover: boolean;
    /**
     * Interest rate expressed as a percentage (e.g. 5 = 5%).
     * Underlying value in the database is stored as basis points.
     */
    rate: number;
    createdAt: Date;
    updatedAt: Date;
}

export class OrderResponse {
    statusCode: HttpStatus;
    data: OrderResponseData;
}
