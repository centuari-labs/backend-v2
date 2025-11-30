export const ERROR_MESSAGES = {
    INVALID_WALLET_ADDRESS: "Invalid wallet address",
    INVALID_ASSET_ADDRESS: "Invalid asset address",
    INVALID_COLLATERAL_ASSET_ADDRESS: "Invalid collateral asset address",
    ORDER_GROUP_NOT_FOUND: (id: number) => `Order group with ID ${id} not found`,
    ORDER_NOT_FOUND: (id: number) => `Order with ID ${id} not found`,
    ORDER_CANNOT_BE_CANCELLED: (id: number) =>
        `Order with ID ${id} not found or cannot be cancelled`,
} as const;
