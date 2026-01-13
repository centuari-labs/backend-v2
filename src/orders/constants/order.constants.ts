export enum OrderSide {
    Lend = "lend",
    Borrow = "borrow",
}

export enum OrderType {
    Market = "market",
    Limit = "limit",
}

export enum OrderStatus {
    Open = "open",
    Filled = "filled",
    Cancelled = "cancelled",
    Partial = "partial", // Keeping partial just in case, though not explicitly in user request default schema, it's common. User default was Open.
}

export const order_group_status = {
    active: "active",
    cancelled: "cancelled",
    completed: "completed",
} as const;
