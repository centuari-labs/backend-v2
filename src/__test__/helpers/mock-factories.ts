import { Order } from "../../orders/entities/order.entity";
import { Account } from "../../orders/entities/account.entity";
import { Market } from "../../market/entities/market.entity";
import { Token } from "../../tokens/entities/token.entity";
import { OrderMarket } from "../../orders/entities/order-market.entity";
import {
    OrderSide,
    OrderType,
    OrderStatus,
} from "../../orders/constants/order.constants";

export const MOCK_IDS = {
    accountId: "a0000000-0000-0000-0000-000000000001",
    assetId: "b0000000-0000-0000-0000-000000000001",
    marketId: "c0000000-0000-0000-0000-000000000001",
    orderId: "d0000000-0000-0000-0000-000000000001",
    tokenAddress: "0x1234567890abcdef1234567890abcdef12345678",
    walletAddress: "0xAbCdEf1234567890abcdef1234567890AbCdEf12",
    privyUserId: "did:privy:mock-user-001",
};

export function createMockOrder(overrides: Partial<Order> = {}): Order {
    return {
        id: MOCK_IDS.orderId,
        accountId: MOCK_IDS.accountId,
        assetId: MOCK_IDS.assetId,
        side: OrderSide.Lend,
        type: OrderType.Limit,
        rate: 500,
        quantity: "1000",
        filledQuantity: "0",
        settlementFee: "50000",
        filledSettlementFee: null,
        status: OrderStatus.Open,
        cancelReason: null,
        autoRollover: false,
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
        updatedAt: new Date("2025-01-01T00:00:00.000Z"),
        ...overrides,
    };
}

export function createMockAccount(overrides: Partial<Account> = {}): Account {
    return {
        id: MOCK_IDS.accountId,
        privyUserId: MOCK_IDS.privyUserId,
        userWallet: MOCK_IDS.walletAddress,
        name: null,
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
        ...overrides,
    };
}

export function createMockMarket(overrides: Partial<Market> = {}): Market {
    return {
        id: MOCK_IDS.marketId,
        assetId: MOCK_IDS.assetId,
        asset: undefined as any,
        maturity: new Date("2025-06-01T00:00:00.000Z"),
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
        ...overrides,
    };
}

export function createMockToken(overrides: Partial<Token> = {}): Token {
    return {
        id: MOCK_IDS.assetId,
        tokenAddress: MOCK_IDS.tokenAddress,
        symbol: "USDC",
        name: "USD Coin",
        isLoanToken: true,
        chainId: 1,
        imageUrl: null,
        averageLTV: null,
        coingeckoId: "usd-coin",
        decimals: 6,
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
        updatedAt: new Date("2025-01-01T00:00:00.000Z"),
        ...overrides,
    };
}

export function createMockOrderMarket(
    overrides: Partial<OrderMarket> = {},
): OrderMarket {
    return {
        orderMarketId: "e0000000-0000-0000-0000-000000000001",
        orderId: MOCK_IDS.orderId,
        marketId: MOCK_IDS.marketId,
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
        ...overrides,
    };
}

export function createMockAccessCode(overrides: Record<string, any> = {}) {
    return {
        id: "ac-uuid-001",
        code: "CENTUARI-ABCDE",
        max_uses: 10,
        current_uses: 0,
        is_active: true,
        expires_at: null,
        created_at: new Date("2025-01-01T00:00:00.000Z"),
        ...overrides,
    };
}
