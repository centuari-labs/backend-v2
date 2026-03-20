import { HttpStatus } from "@nestjs/common";
import {
    OrderSide,
    OrderStatus,
    OrderType,
} from "../constants/order.constants";

export interface OrderResponseData {
    orderId: string;
    walletAddress: string;
    assetId: string;
    /**
     * Markets associated with this order.
     * Each entry links to a market (`markets.id`) and its maturity.
     */
    markets: {
        /**
         * ID of the market (`markets.id`).
         */
        marketId: string;
        /**
         * Maturity for this market as a Unix timestamp in seconds.
         */
        maturity: number;
    }[];
    timestamp: number;
    side: OrderSide;
    type: OrderType;
    status: OrderStatus;
    originalAmount: string;
    settlementFeeAmount: string;
    estimatedTradeFeeAmount: string;
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
