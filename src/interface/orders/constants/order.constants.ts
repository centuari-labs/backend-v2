export const ORDER_TYPE = {
    LEND_MARKET: "lend_market",
    LEND_LIMIT: "lend_limit",
    BORROW_MARKET: "borrow_market",
    BORROW_LIMIT: "borrow_limit",
} as const;

export const ORDER_CATEGORY = {
    LEND: "lend",
    BORROW: "borrow",
} as const;

export const ORDER_STATUS = {
    PENDING: "pending",
    PARTIAL: "partial",
    FILLED: "filled",
    CANCELLED: "cancelled",
} as const;

export const ORDER_GROUP_STATUS = {
    ACTIVE: "active",
    CANCELLED: "cancelled",
    COMPLETED: "completed",
} as const;
