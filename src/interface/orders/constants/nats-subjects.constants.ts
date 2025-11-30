export const NATS_SUBJECTS = {
    ORDERS: {
        LEND: {
            MARKET: {
                CREATED: "orders.lend.market.created",
                UPDATED: "orders.lend.market.updated",
                CANCELLED: "orders.lend.market.cancelled",
                FILLED: "orders.lend.market.filled",
            },
            LIMIT: {
                CREATED: "orders.lend.limit.created",
                UPDATED: "orders.lend.limit.updated",
                CANCELLED: "orders.lend.limit.cancelled",
                FILLED: "orders.lend.limit.filled",
            },
        },
        BORROW: {
            MARKET: {
                CREATED: "orders.borrow.market.created",
                UPDATED: "orders.borrow.market.updated",
                CANCELLED: "orders.borrow.market.cancelled",
                FILLED: "orders.borrow.market.filled",
            },
            LIMIT: {
                CREATED: "orders.borrow.limit.created",
                UPDATED: "orders.borrow.limit.updated",
                CANCELLED: "orders.borrow.limit.cancelled",
                FILLED: "orders.borrow.limit.filled",
            },
        },
    },
} as const;
