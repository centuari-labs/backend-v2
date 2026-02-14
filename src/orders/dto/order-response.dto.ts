import { HttpStatus } from "@nestjs/common";
import { OrderSide, OrderStatus, OrderType } from "../constants/order.constants";

export interface OrderResponseData {
    orderId: string;
    walletAddress: string;
    assetId: string;
    /**
     * Market IDs associated with this order.
     * Each ID references the `markets.id` column.
     */
    marketIds: string[]; //@todo : we should have keep market ids and maturities into 1 object
    /**
     * Maturities for the order as Unix timestamps (seconds),
     * derived from the associated markets in the same order as `marketIds`.
     */
    maturities: number[];
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
