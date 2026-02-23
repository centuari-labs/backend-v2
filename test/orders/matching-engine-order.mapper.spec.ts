import { orderSchema } from "../../src/orders/matching-engine/order.schema";
import { OrderSide, OrderStatus, OrderType } from "../../src/orders/constants/order.constants";

describe("Matching engine order schema", () => {
    it("accepts a valid lend limit order payload", () => {
        const payload = {
            orderId: "550e8400-e29b-41d4-a716-446655440000",
            walletAddress: "0x1111111111111111111111111111111111111111",
            loanToken: "0x2222222222222222222222222222222222222222",
            markets: [
                {
                    marketId: "550e8400-e29b-41d4-a716-446655440001",
                    maturity: 1710000000,
                },
            ],
            timestamp: 1710000000,
            side: OrderSide.Lend,
            type: OrderType.Limit,
            status: OrderStatus.Open,
            originalAmount: "1000",
            remainingAmount: "1000",
            settlementFeeAmount: "10",
            remainingSettlementFeeAmount: "10",
            rate: 500,
        };

        const parsed = orderSchema.parse(payload);
        expect(parsed).toBeDefined();
    });

    it("accepts a valid borrow market order payload without rate", () => {
        const payload = {
            orderId: "550e8400-e29b-41d4-a716-446655440010",
            walletAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            loanToken: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            markets: [
                {
                    marketId: "550e8400-e29b-41d4-a716-446655440011",
                    maturity: 1710000000,
                },
            ],
            timestamp: 1710000000,
            side: OrderSide.Borrow,
            type: OrderType.Market,
            status: OrderStatus.Open,
            originalAmount: "5000",
            remainingAmount: "5000",
            settlementFeeAmount: "25",
            remainingSettlementFeeAmount: "25",
        };

        const parsed = orderSchema.parse(payload);
        expect(parsed).toBeDefined();
        expect(parsed.rate).toBeUndefined();
    });
});

