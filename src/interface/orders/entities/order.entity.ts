export type OrderType =
    | "lend_market"
    | "lend_limit"
    | "borrow_market"
    | "borrow_limit";

export type OrderCategory = "lend" | "borrow";

export type OrderStatus =
    | "pending"
    | "partial"
    | "filled"
    | "cancelled"

export interface Order {
    id: number;
    order_group_id: number | null;
    wallet_address: string;

    order_type: OrderType;
    order_category: OrderCategory;
    is_market_order: boolean;

    asset_address: string;
    amount: string;

    limit_price: string | null;
    limit_expiry: Date | null;

    interest_rate: string | null;
    duration_days: number | null;

    // Collateral Information
    collateral_asset_address: string | null;
    collateral_amount: string | null;
    collateral_ratio: string | null;

    status: OrderStatus;
    filled_amount: string;
    remaining_amount: string;

    // Transaction Information
    transaction_hash: string | null;
    block_number: number | null;

    // Timestamps
    created_at: Date;
    updated_at: Date;
    filled_at: Date | null;
    cancelled_at: Date | null;
}

export interface OrderHistory {
    id: number;
    order_id: number;
    previous_status: OrderStatus | null;
    new_status: OrderStatus;
    previous_filled_amount: string | null;
    new_filled_amount: string | null;
    change_reason: string | null;
    transaction_hash: string | null;
    created_at: Date;
}
