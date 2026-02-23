import { Test, TestingModule } from "@nestjs/testing";
import { CoinGeckoProvider } from "../../../price/providers/coingecko.provider";
import type { Token } from "../../../tokens/entities/token.entity";

/**
 * Integration tests that hit the real CoinGecko API.
 * Run with: pnpm test src/__test__/price/providers/coingecko.provider.integration.test.ts
 * Requires network access.
 */
describe("CoinGeckoProvider (integration)", () => {
    let provider: CoinGeckoProvider;

    const createToken = (overrides: Partial<Token> = {}): Token => ({
        id: "uuid-token-001",
        tokenAddress: "0xusdc1234567890abcdef1234567890abcdef12",
        symbol: "USDC",
        name: "USD Coin",
        isLoanToken: true,
        decimals: 6,
        chainId: 84532,
        averageLTV: 0.75,
        coingeckoId: "usd-coin",
        decimals: 6,
        imageUrl: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    });

    beforeAll(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [CoinGeckoProvider],
        }).compile();

        provider = module.get(CoinGeckoProvider);
    });

    describe("fetchPrices", () => {
        it("should fetch real prices from CoinGecko API", async () => {
            const tokens: Token[] = [
                createToken({ symbol: "USDC", coingeckoId: "usd-coin" }),
                createToken({
                    id: "uuid-token-002",
                    tokenAddress: "0xeth1234567890abcdef1234567890abcdef12",
                    symbol: "ETH",
                    coingeckoId: "ethereum",
                    decimals: 18,
                }),
            ];

            const result = await provider.fetchPrices(tokens);

            expect(result.USDC).toBeDefined();
            expect(typeof result.USDC).toBe("number");
            expect(result.USDC).toBeGreaterThan(0.9);
            expect(result.USDC).toBeLessThan(1.1);

            expect(result.ETH).toBeDefined();
            expect(typeof result.ETH).toBe("number");
            expect(result.ETH).toBeGreaterThan(0);
        });

        it("should filter out tokens without coingeckoId", async () => {
            const tokens: Token[] = [
                createToken({ symbol: "USDC", coingeckoId: "usd-coin" }),
                createToken({ symbol: "LOCAL", coingeckoId: null }),
            ];

            const result = await provider.fetchPrices(tokens);

            expect(result.USDC).toBeDefined();
            expect(result.LOCAL).toBeUndefined();
        });

        it("should return empty object for empty token list", async () => {
            const result = await provider.fetchPrices([]);

            expect(result).toEqual({});
        });
    });
});
