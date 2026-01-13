export const error_messages = {
    invalid_wallet_address: "Invalid wallet address",
    invalid_asset_address: "Invalid asset address",
    invalid_token_address: "Invalid token address",
    invalid_collateral_asset_address: "Invalid collateral asset address",
    token_not_supported: (address: string) =>
        `Token ${address} is not supported`,
    order_group_not_found: (id: number) =>
        `Order group with ID ${id} not found`,
    order_not_found: (id: number) => `Order with ID ${id} not found`,
    order_not_owned: "You do not own this order",
    order_cannot_be_cancelled: (id: number) =>
        `Order with ID ${id} not found or cannot be cancelled`,
    order_invalid_status_for_cancel:
        "Order can only be cancelled when status is pending or partial",
} as const;
