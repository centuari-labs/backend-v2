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
