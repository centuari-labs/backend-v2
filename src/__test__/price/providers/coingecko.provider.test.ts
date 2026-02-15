import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { CoinGeckoProvider } from "../../../price/providers/coingecko.provider";
import type { Token } from "../../../tokens/entities/token.entity";

describe("CoinGeckoProvider", () => {
    let provider: CoinGeckoProvider;
    let fetchSpy: jest.SpyInstance;
    let loggerErrorSpy: jest.SpyInstance;

    beforeAll(() => {
        loggerErrorSpy = jest.spyOn(Logger.prototype, "error").mockImplementation(() => { });
    });

    afterAll(() => {
        loggerErrorSpy.mockRestore();
    });

    const createToken = (overrides: Partial<Token> = {}): Token => ({
        id: "uuid-token-001",
        tokenAddress: "0xusdc1234567890abcdef1234567890abcdef12",
        symbol: "USDC",
        name: "USD Coin",
        decimals: 6,
        isLoanToken: true,
        chainId: 84532,
        averageLTV: 0.75,
        coingeckoId: "usd-coin",
        decimals: 6,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    });

    beforeEach(async () => {
        fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue({
            ok: true,
            json: jest.fn().mockResolvedValue({}),
        } as unknown as Response);

        const module: TestingModule = await Test.createTestingModule({
            providers: [CoinGeckoProvider],
        }).compile();

        provider = module.get(CoinGeckoProvider);
    });

    afterEach(() => {
        fetchSpy.mockRestore();
    });

    describe("fetchPrices", () => {
        it("should return prices for tokens with coingeckoId", async () => {
            const token = createToken();
            const mockResponse = { "usd-coin": { usd: 1.0 } };
            (fetchSpy as jest.Mock).mockResolvedValue({
                ok: true,
                json: jest.fn().mockResolvedValue(mockResponse),
            } as unknown as Response);

            const result = await provider.fetchPrices([token]);

            expect(result).toEqual({ USDC: 1.0 });
        });

        it("should filter out tokens without coingeckoId and not call API when all filtered", async () => {
            const tokenWithoutCoingecko = createToken({ coingeckoId: null, symbol: "LOCAL" });

            const result = await provider.fetchPrices([tokenWithoutCoingecko]);

            expect(result).toEqual({});
            expect(fetchSpy).not.toHaveBeenCalled();
        });

        it("should return empty object for empty token list", async () => {
            const result = await provider.fetchPrices([]);

            expect(result).toEqual({});
            expect(fetchSpy).not.toHaveBeenCalled();
        });

        it("should deduplicate coin IDs and map correctly for multiple tokens with same coingeckoId", async () => {
            const token1 = createToken({ symbol: "WBTC", coingeckoId: "bitcoin" });
            const token2 = createToken({
                id: "uuid-token-002",
                tokenAddress: "0xwbtc2234567890abcdef1234567890abcdef12",
                symbol: "WBTC2",
                coingeckoId: "bitcoin",
                decimals: 18,
            });
            const mockResponse = { bitcoin: { usd: 50000 } };
            (fetchSpy as jest.Mock).mockResolvedValue({
                ok: true,
                json: jest.fn().mockResolvedValue(mockResponse),
            } as unknown as Response);

            const result = await provider.fetchPrices([token1, token2]);

            expect(result["WBTC2"]).toBe(50000);
            expect(fetchSpy).toHaveBeenCalledWith(
                expect.stringContaining("ids=bitcoin"),
            );
            expect(fetchSpy).toHaveBeenCalledWith(
                expect.stringContaining("vs_currencies=usd"),
            );
        });

        it("should return empty object when API returns 404", async () => {
            const token = createToken();
            (fetchSpy as jest.Mock).mockResolvedValue({
                ok: false,
                status: 404,
                statusText: "Not Found",
            } as unknown as Response);

            const result = await provider.fetchPrices([token]);

            expect(result).toEqual({});
        });

        it("should return empty object when API returns 500", async () => {
            const token = createToken();
            (fetchSpy as jest.Mock).mockResolvedValue({
                ok: false,
                status: 500,
                statusText: "Internal Server Error",
            } as unknown as Response);

            const result = await provider.fetchPrices([token]);

            expect(result).toEqual({});
        });

        it("should return empty object when fetch throws (network error)", async () => {
            const token = createToken();
            (fetchSpy as jest.Mock).mockRejectedValue(new Error("Network error"));

            const result = await provider.fetchPrices([token]);

            expect(result).toEqual({});
        });

        it("should only include tokens with numeric price in response", async () => {
            const tokenUsdc = createToken({ symbol: "USDC", coingeckoId: "usd-coin" });
            const tokenEth = createToken({
                id: "uuid-token-002",
                tokenAddress: "0xeth1234567890abcdef1234567890abcdef12",
                symbol: "ETH",
                coingeckoId: "ethereum",
                decimals: 18,
            });
            const mockResponse = {
                "usd-coin": { usd: 1.0 },
                ethereum: {},
            };
            (fetchSpy as jest.Mock).mockResolvedValue({
                ok: true,
                json: jest.fn().mockResolvedValue(mockResponse),
            } as unknown as Response);

            const result = await provider.fetchPrices([tokenUsdc, tokenEth]);

            expect(result).toEqual({ USDC: 1.0 });
            expect(result).not.toHaveProperty("ETH");
        });

        it("should call fetch with correct URL containing ids and vs_currencies", async () => {
            const token = createToken({ coingeckoId: "usd-coin" });
            (fetchSpy as jest.Mock).mockResolvedValue({
                ok: true,
                json: jest.fn().mockResolvedValue({ "usd-coin": { usd: 1.0 } }),
            } as unknown as Response);

            await provider.fetchPrices([token]);

            expect(fetchSpy).toHaveBeenCalledWith(
                "https://api.coingecko.com/api/v3/simple/price?ids=usd-coin&vs_currencies=usd",
            );
        });
    });
});
