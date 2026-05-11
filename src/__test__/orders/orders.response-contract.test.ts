import { HttpStatus } from "@nestjs/common";
import {
    OrderSide,
    OrderType,
    OrderStatus,
} from "src/orders/constants/order.constants";
import { OrderResponse } from "src/orders/dto/order-response.dto";
import { toPercentage } from "src/common/utils/number.utils";

describe("OrderResponse contract", () => {
    const mockOrderId = "d0000000-0000-0000-0000-000000000001";
    const mockWallet = "0xAbc123";
    const mockAssetId = "b0000000-0000-0000-0000-000000000001";
    const mockMarketId = "c0000000-0000-0000-0000-000000000001";

    function buildOrderResponse(
        overrides: Partial<OrderResponse> = {},
    ): OrderResponse {
        return {
            orderId: mockOrderId,
            walletAddress: mockWallet,
            assetId: mockAssetId,
            markets: [{ marketId: mockMarketId, maturity: 1748736000 }],
            timestamp: Date.now(),
            side: OrderSide.Lend,
            type: OrderType.Limit,
            status: OrderStatus.Open,
            originalAmount: "1000",
            settlementFeeAmount: "50000",
            estimatedTradeFeeAmount: "100000",
            autoRollover: false,
            rate: 6.5,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...overrides,
        };
    }

    it("has all required fields", () => {
        const resp = buildOrderResponse();
        const required: (keyof OrderResponse)[] = [
            "orderId",
            "walletAddress",
            "assetId",
            "markets",
            "timestamp",
            "side",
            "type",
            "status",
            "originalAmount",
            "settlementFeeAmount",
            "estimatedTradeFeeAmount",
            "autoRollover",
            "rate",
            "createdAt",
            "updatedAt",
        ];
        for (const field of required) {
            expect(resp).toHaveProperty(field);
        }
    });

    it("markets array contains { marketId, maturity } entries", () => {
        const resp = buildOrderResponse();
        expect(resp.markets).toHaveLength(1);
        expect(resp.markets[0]).toEqual({
            marketId: mockMarketId,
            maturity: 1748736000,
        });
    });

    it("maturity is Unix timestamp in seconds (not milliseconds)", () => {
        const resp = buildOrderResponse();
        const maturity = resp.markets[0].maturity;
        // Unix seconds should be in the billions range (not trillions)
        expect(maturity).toBeGreaterThan(1_000_000_000);
        expect(maturity).toBeLessThan(10_000_000_000);
    });

    describe("rate conversion: BPS → percentage", () => {
        it("converts 650 BPS to 6.5 percentage", () => {
            expect(toPercentage(650)).toBe(6.5);
        });

        it("converts 500 BPS to 5 percentage", () => {
            expect(toPercentage(500)).toBe(5);
        });

        it("converts 10000 BPS to 100 percentage", () => {
            expect(toPercentage(10000)).toBe(100);
        });

        it("converts 1 BPS to 0.01 percentage", () => {
            expect(toPercentage(1)).toBe(0.01);
        });

        it("handles null as 0", () => {
            expect(toPercentage(null)).toBe(0);
        });

        it("handles undefined as 0", () => {
            expect(toPercentage(undefined)).toBe(0);
        });
    });

    it("response rate field is in percentage (not BPS)", () => {
        // Simulate what mapToResponse does: DB stores 650 BPS, response gets 6.5%
        const dbRateBps = 650;
        const responseRate = toPercentage(dbRateBps);
        const resp = buildOrderResponse({ rate: responseRate });

        expect(resp.rate).toBe(6.5);
    });

    it("orderId is a UUID string", () => {
        const resp = buildOrderResponse();
        expect(resp.orderId).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );
    });

    it("side enum values are LEND or BORROW", () => {
        expect(buildOrderResponse({ side: OrderSide.Lend }).side).toBe("LEND");
        expect(buildOrderResponse({ side: OrderSide.Borrow }).side).toBe(
            "BORROW",
        );
    });

    it("type enum values are MARKET or LIMIT", () => {
        expect(buildOrderResponse({ type: OrderType.Market }).type).toBe(
            "MARKET",
        );
        expect(buildOrderResponse({ type: OrderType.Limit }).type).toBe(
            "LIMIT",
        );
    });

    it("status enum values cover all states", () => {
        expect(OrderStatus.Open).toBe("OPEN");
        expect(OrderStatus.Filled).toBe("FILLED");
        expect(OrderStatus.Cancelled).toBe("CANCELLED");
        expect(OrderStatus.PartiallyFilled).toBe("PARTIALLY_FILLED");
    });
});
