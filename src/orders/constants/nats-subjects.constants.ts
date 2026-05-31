export const NATS_SUBJECTS = {
    LEND_MARKET: "orders.lend.market",
    LEND_LIMIT: "orders.lend.limit",
    BORROW_MARKET: "orders.borrow.market",
    BORROW_LIMIT: "orders.borrow.limit",
    CANCEL: "orders.cancel",
    // Request/reply: backend awaits the engine's authoritative verdict before
    // persisting CANCELLED (C1 engine-coordinated cancel).
    CANCEL_REQUEST: "orders.cancel.request",
    MATCH_CREATED: "matches.created",
    UPDATE: "orders.update",
} as const;
