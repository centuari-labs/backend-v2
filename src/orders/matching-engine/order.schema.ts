import { z } from "zod";
import {
    OrderSide,
    OrderStatus,
    OrderType,
} from "../constants/order.constants";

/**
 * Ethereum address validation schema
 *
 * Validates Ethereum addresses in the standard format (0x followed by 40 hexadecimal characters).
 * This schema is used across the project for validating wallet addresses, token addresses, and collateral token addresses.
 */
export const ethereumAddressSchema = z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address format");

/**
 * Schema for a single market slot: a market UUID and its corresponding maturity timestamp.
 *
 * Orders specify which markets they participate in via an array of these slots.
 * Each entry must have both a valid market ID and a positive integer maturity.
 */
export const marketSlotSchema = z.object({
    marketId: z.string().uuid("Market ID must be a valid UUID"),
    maturity: z.number().int().positive("Maturity must be a positive integer"),
});

export type MarketSlot = z.infer<typeof marketSlotSchema>;

/**
 * Base order schema with common fields.
 *
 * All monetary values are represented as decimal strings containing only digits.
 * This avoids precision issues when dealing with very large integers.
 * Markets are represented as an array of { marketId, maturity } slots; the array must be non-empty.
 */
const baseOrderSchema = z.object({
    orderId: z.string().uuid("Order ID must be a valid UUID"),
    walletAddress: ethereumAddressSchema,
    loanToken: ethereumAddressSchema,
    assetId: z.string().uuid("Asset ID must be a valid UUID"),
    markets: z
        .array(marketSlotSchema)
        .min(1, "At least one market slot is required"),
    timestamp: z
        .number()
        .int()
        .positive("Timestamp must be a positive integer"),
    side: z.nativeEnum(OrderSide),
    type: z.nativeEnum(OrderType),
    status: z.nativeEnum(OrderStatus).default(OrderStatus.Open),
    originalAmount: z
        .string()
        .regex(/^\d+$/, "Amount must be a positive integer string"),
    remainingAmount: z
        .string()
        .regex(/^\d+$/, "Amount must be a positive integer string"),
    settlementFeeAmount: z
        .string()
        .regex(/^\d+$/, "Fee amount must be a positive integer string"),
    remainingSettlementFeeAmount: z
        .string()
        .regex(/^\d+$/, "Fee amount must be a positive integer string")
        .optional(),
});

export const lendMarketOrderSchema = baseOrderSchema.extend({
    side: z.literal(OrderSide.Lend),
    type: z.literal(OrderType.Market),
    rate: z.undefined().optional(),
});

export const lendLimitOrderSchema = baseOrderSchema.extend({
    side: z.literal(OrderSide.Lend),
    type: z.literal(OrderType.Limit),
    rate: z
        .number()
        .int("Rate must be an integer")
        .min(0, "Rate must be non-negative")
        .max(10000, "Rate must not exceed 10000 basis points (100%)"),
});

export const borrowMarketOrderSchema = baseOrderSchema.extend({
    side: z.literal(OrderSide.Borrow),
    type: z.literal(OrderType.Market),
    rate: z.undefined().optional(),
});

export const borrowLimitOrderSchema = baseOrderSchema.extend({
    side: z.literal(OrderSide.Borrow),
    type: z.literal(OrderType.Limit),
    rate: z
        .number()
        .int("Rate must be an integer")
        .min(0, "Rate must be non-negative")
        .max(10000, "Rate must not exceed 10000 basis points (100%)"),
});

export const updateOrderSchema = z.object({
    orderId: z.string().uuid("Order ID must be a valid UUID"),
    walletAddress: ethereumAddressSchema,
})

export const orderSchema = z.union([
    lendMarketOrderSchema,
    lendLimitOrderSchema,
    borrowMarketOrderSchema,
    borrowLimitOrderSchema,
]);

export type LendMarketOrder = z.infer<typeof lendMarketOrderSchema>;
export type LendLimitOrder = z.infer<typeof lendLimitOrderSchema>;
export type BorrowMarketOrder = z.infer<typeof borrowMarketOrderSchema>;
export type BorrowLimitOrder = z.infer<typeof borrowLimitOrderSchema>;
export type MatchingEngineOrder = z.infer<typeof orderSchema>;
export type UpdateOrder = z.infer<typeof updateOrderSchema>;
