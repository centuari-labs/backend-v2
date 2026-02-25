export const NATS_SUBJECTS = {
    LEND_MARKET: "orders.lend.market",
    LEND_LIMIT: "orders.lend.limit",
    BORROW_MARKET: "orders.borrow.market",
    BORROW_LIMIT: "orders.borrow.limit",
    CANCEL: "orders.cancel",
    MATCH_CREATED: "matches.created",
} as const;
