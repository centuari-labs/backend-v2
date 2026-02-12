export enum OrderSide {
    Lend = "LEND",
    Borrow = "BORROW",
}

export enum OrderType {
    Market = "MARKET",
    Limit = "LIMIT",
}

export enum OrderStatus {
    Open = "OPEN",
    Filled = "FILLED",
    Cancelled = "CANCELLED",
    PartiallyFilled = "PARTIALLY_FILLED",
}

export const order_group_status = {
    active: "active",
    cancelled: "cancelled",
    completed: "completed",
} as const;

// Settlement fee configuration
export const SETTLEMENT_FEE_RATE_BPS = 1; // 0.01%
export const SETTLEMENT_FEE_MAX_CAP_USD = 0.05;
