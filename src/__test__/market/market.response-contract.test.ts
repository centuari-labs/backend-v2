import { MarketResponseDto, MarketItemDto } from "src/market/dto/market.dto";
import { toPercentage } from "src/common/utils/number.utils";

describe("MarketResponseDto contract", () => {
    function buildMarketResponse(
        overrides: Partial<MarketResponseDto> = {},
    ): MarketResponseDto {
        return {
            total_deposit: "1500000.00",
            active_loans: "750000.00",
            markets: [
                {
                    assetId: "b0000000-0000-0000-0000-000000000001",
                    market: {
                        market_id: "c0000000-0000-0000-0000-000000000001",
                        maturity: 1748736000,
                    },
                    borrow_rate: 10.1,
                    lend_rate: 6.5,
                    collateral_factor: 75,
                },
            ],
            ...overrides,
        };
    }

    it("has total_deposit and active_loans as strings", () => {
        const resp = buildMarketResponse();
        expect(typeof resp.total_deposit).toBe("string");
        expect(typeof resp.active_loans).toBe("string");
    });

    it("has markets array with MarketItemDto entries", () => {
        const resp = buildMarketResponse();
        expect(resp.markets).toHaveLength(1);
    });

    describe("MarketItemDto shape", () => {
        it("item has assetId string", () => {
            const resp = buildMarketResponse();
            const item = resp.markets[0];
            expect(typeof item.assetId).toBe("string");
            expect(item.assetId).toBe("b0000000-0000-0000-0000-000000000001");
        });

        it("market has market_id and maturity", () => {
            const resp = buildMarketResponse();
            const item = resp.markets[0];
            expect(item.market).toHaveProperty("market_id");
            expect(item.market).toHaveProperty("maturity");
        });

        it("market_id can be null when no market exists", () => {
            const resp = buildMarketResponse({
                markets: [
                    {
                        assetId: "b0000000-0000-0000-0000-000000000001",
                        market: { market_id: null, maturity: null },
                        borrow_rate: 0,
                        lend_rate: 0,
                        collateral_factor: 0,
                    },
                ],
            });
            expect(resp.markets[0].market.market_id).toBeNull();
            expect(resp.markets[0].market.maturity).toBeNull();
        });

        it("maturity is Unix seconds (not milliseconds)", () => {
            const resp = buildMarketResponse();
            const maturity = resp.markets[0].market.maturity!;
            expect(maturity).toBeGreaterThan(1_000_000_000);
            expect(maturity).toBeLessThan(10_000_000_000);
        });
    });

    describe("rate conversion: BPS → percentage", () => {
        it("lend_rate is a percentage (650 BPS → 6.5)", () => {
            const rate = toPercentage(650);
            expect(rate).toBe(6.5);
        });

        it("borrow_rate is a percentage (1010 BPS → 10.1)", () => {
            const rate = toPercentage(1010);
            expect(rate).toBe(10.1);
        });

        it("collateral_factor is a percentage (7500 BPS → 75)", () => {
            const factor = toPercentage(7500);
            expect(factor).toBe(75);
        });
    });
});
