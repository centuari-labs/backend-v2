import {
    OrderSide,
    OrderStatus,
    OrderType,
} from "../../orders/constants/order.constants";
import type { Account } from "../../orders/entities/account.entity";
import type { Order } from "../../orders/entities/order.entity";
import type { Token } from "../../tokens/entities/token.entity";

export const mockWalletAddress = "0xLender1234567890abcdef1234567890abcdef12";
export const mockPrivyUserId = "did:privy:mock-user-id";
export const mockTokenAddress = "0xToken1234567890abcdef1234567890abcdef12";
export const mockAccountId = "uuid-account-001";
export const mockAssetId = "uuid-asset-001";

export function createMockOrder(overrides: Partial<Order> = {}): Order {
    return {
        id: "uuid-order-001",
        accountId: mockAccountId,
        assetId: mockAssetId,
        quantity: "1000",
        filledQuantity: "0",
        settlementFee: "0",
        side: OrderSide.Lend,
        type: OrderType.Limit,
        status: OrderStatus.Open,
        rate: 500,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
        ...overrides,
    };
}

export function createMockAccount(overrides: Partial<Account> = {}): Account {
    return {
        id: mockAccountId,
        privyUserId: mockPrivyUserId,
        userWallet: mockWalletAddress,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        ...overrides,
    };
}

export function createMockToken(overrides: Partial<Token> = {}): Token {
    return {
        id: mockAssetId,
        tokenAddress: mockTokenAddress,
        symbol: "USDC",
        name: "USD Coin",
        imageUrl: "https://example.com/usdc.png",
        isLoanToken: true,
        LLTV: 0.86,
        LT: 0.86,
        LP: 0.99,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
        ...overrides,
    };
}
