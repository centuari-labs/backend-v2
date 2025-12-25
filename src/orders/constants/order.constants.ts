export const order_type = {
    lend_market: "lend_market",
    lend_limit: "lend_limit",
    borrow_market: "borrow_market",
    borrow_limit: "borrow_limit",
} as const;

export const order_category = {
    lend: "lend",
    borrow: "borrow",
} as const;

export const order_status = {
    pending: "pending",
    partial: "partial",
    filled: "filled",
    cancelled: "cancelled",
} as const;

export const order_group_status = {
    active: "active",
    cancelled: "cancelled",
    completed: "completed",
} as const;
