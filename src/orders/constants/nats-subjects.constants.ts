export const nats_subjects = {
    orders: {
        lend: {
            market: {
                created: "orders.lend.market",
                updated: "orders.lend.market.updated",
                cancelled: "orders.lend.market.cancelled",
                filled: "orders.lend.market.filled",
            },
            limit: {
                created: "orders.lend.limit",
                updated: "orders.lend.limit.updated",
                cancelled: "orders.lend.limit.cancelled",
                filled: "orders.lend.limit.filled",
            },
        },
        borrow: {
            market: {
                created: "orders.borrow.market",
                updated: "orders.borrow.market.updated",
                cancelled: "orders.borrow.market.cancelled",
                filled: "orders.borrow.market.filled",
            },
            limit: {
                created: "orders.borrow.limit",
                updated: "orders.borrow.limit.updated",
                cancelled: "orders.borrow.limit.cancelled",
                filled: "orders.borrow.limit.filled",
            },
        },
        cancel: "orders.cancel",
    },
} as const;

