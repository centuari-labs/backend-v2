import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { PriceService } from "../../price/price.service";
import { TokensService } from "../../tokens/tokens.service";
import { PRICE_PROVIDER } from "../../price/interfaces/price-provider.interface";
import type { Token } from "../../tokens/entities/token.entity";

describe("PriceService", () => {
    let service: PriceService;
    let tokensService: jest.Mocked<TokensService>;
    let priceProvider: { fetchPrices: jest.Mock };
    let loggerErrorSpy: jest.SpyInstance;
    let loggerWarnSpy: jest.SpyInstance;
    let loggerLogSpy: jest.SpyInstance;
    let loggerDebugSpy: jest.SpyInstance;

    beforeAll(() => {
        loggerErrorSpy = jest.spyOn(Logger.prototype, "error").mockImplementation(() => {});
        loggerWarnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
        loggerLogSpy = jest.spyOn(Logger.prototype, "log").mockImplementation(() => {});
        loggerDebugSpy = jest.spyOn(Logger.prototype, "debug").mockImplementation(() => {});
    });

    afterAll(() => {
        loggerErrorSpy.mockRestore();
        loggerWarnSpy.mockRestore();
        loggerLogSpy.mockRestore();
        loggerDebugSpy.mockRestore();
    });

    const mockToken: Token = {
        id: "uuid-token-001",
        tokenAddress: "0xusdc1234567890abcdef1234567890abcdef12",
        symbol: "USDC",
        name: "USD Coin",
        isLoanToken: true,
        chainId: 84532,
        averageLTV: 0.75,
        coingeckoId: "usd-coin",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const mockTokenEth: Token = {
        ...mockToken,
        id: "uuid-token-002",
        tokenAddress: "0xeth1234567890abcdef1234567890abcdef12",
        symbol: "ETH",
        name: "Ethereum",
        coingeckoId: "ethereum",
    };

    beforeEach(async () => {
        const mockTokensService = {
            getActiveTokens: jest.fn(),
        };

        const mockPriceProvider = {
            fetchPrices: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PriceService,
                { provide: TokensService, useValue: mockTokensService },
                { provide: PRICE_PROVIDER, useValue: mockPriceProvider },
            ],
        }).compile();

        service = module.get(PriceService);
        tokensService = module.get(TokensService);
        priceProvider = module.get(PRICE_PROVIDER);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("getPrice", () => {
        it("should return cached price when token is in cache", async () => {
            tokensService.getActiveTokens.mockResolvedValue([mockToken]);
            priceProvider.fetchPrices.mockResolvedValue({ USDC: 1.0 });

            await service.fetchAndUpdatePrices();

            const result = await service.getPrice(mockToken.tokenAddress);

            expect(result).toBe(1.0);
        });

        it("should return null when token not in cache and cache is populated", async () => {
            tokensService.getActiveTokens.mockResolvedValue([mockToken]);
            priceProvider.fetchPrices.mockResolvedValue({ USDC: 1.0 });

            await service.fetchAndUpdatePrices();

            const result = await service.getPrice("0xunknown1234567890abcdef1234567890abcdef12");

            expect(result).toBeNull();
        });

        it("should trigger fetch and return price on cold start (empty cache)", async () => {
            tokensService.getActiveTokens.mockResolvedValue([mockToken]);
            priceProvider.fetchPrices.mockResolvedValue({ USDC: 1.0 });

            const result = await service.getPrice(mockToken.tokenAddress);

            expect(result).toBe(1.0);
            expect(tokensService.getActiveTokens).toHaveBeenCalled();
            expect(priceProvider.fetchPrices).toHaveBeenCalledWith([mockToken]);
        });

        it("should normalize address to lowercase for lookup", async () => {
            tokensService.getActiveTokens.mockResolvedValue([mockToken]);
            priceProvider.fetchPrices.mockResolvedValue({ USDC: 1.0 });

            await service.fetchAndUpdatePrices();

            const result = await service.getPrice(mockToken.tokenAddress.toUpperCase());

            expect(result).toBe(1.0);
        });
    });

    describe("getPrices", () => {
        it("should return Record of address to price when cache is populated", async () => {
            tokensService.getActiveTokens.mockResolvedValue([mockToken, mockTokenEth]);
            priceProvider.fetchPrices.mockResolvedValue({ USDC: 1.0, ETH: 2500 });

            await service.fetchAndUpdatePrices();

            const result = service.getPrices();

            expect(result).toEqual({
                [mockToken.tokenAddress.toLowerCase()]: 1.0,
                [mockTokenEth.tokenAddress.toLowerCase()]: 2500,
            });
        });

        it("should return empty object when cache is empty", () => {
            const result = service.getPrices();

            expect(result).toEqual({});
        });
    });

    describe("isCacheReady", () => {
        it("should return false when cache is empty", () => {
            expect(service.isCacheReady()).toBe(false);
        });

        it("should return true when cache is populated", async () => {
            tokensService.getActiveTokens.mockResolvedValue([mockToken]);
            priceProvider.fetchPrices.mockResolvedValue({ USDC: 1.0 });

            await service.fetchAndUpdatePrices();

            expect(service.isCacheReady()).toBe(true);
        });
    });

    describe("fetchAndUpdatePrices", () => {
        it("should update cache and map symbol to address correctly", async () => {
            tokensService.getActiveTokens.mockResolvedValue([mockToken, mockTokenEth]);
            priceProvider.fetchPrices.mockResolvedValue({ USDC: 1.0, ETH: 2500 });

            await service.fetchAndUpdatePrices();

            expect(service.isCacheReady()).toBe(true);
            expect(await service.getPrice(mockToken.tokenAddress)).toBe(1.0);
            expect(await service.getPrice(mockTokenEth.tokenAddress)).toBe(2500);
        });

        it("should skip fetch and log warning when no tokens from TokensService", async () => {
            const warnSpy = jest.spyOn(service["logger"], "warn");
            tokensService.getActiveTokens.mockResolvedValue([]);

            await service.fetchAndUpdatePrices();

            expect(warnSpy).toHaveBeenCalledWith("No tokens found, skipping price fetch");
            expect(priceProvider.fetchPrices).not.toHaveBeenCalled();
            expect(service.isCacheReady()).toBe(false);
        });

        it("should keep existing cache when provider throws", async () => {
            tokensService.getActiveTokens.mockResolvedValue([mockToken]);
            priceProvider.fetchPrices.mockResolvedValue({ USDC: 1.0 });

            await service.fetchAndUpdatePrices();
            expect(await service.getPrice(mockToken.tokenAddress)).toBe(1.0);

            priceProvider.fetchPrices.mockRejectedValue(new Error("API error"));

            await service.fetchAndUpdatePrices();

            expect(await service.getPrice(mockToken.tokenAddress)).toBe(1.0);
        });
    });

    describe("onModuleInit", () => {
        it("should call fetchAndUpdatePrices", async () => {
            tokensService.getActiveTokens.mockResolvedValue([mockToken]);
            priceProvider.fetchPrices.mockResolvedValue({ USDC: 1.0 });

            await service.onModuleInit();

            expect(tokensService.getActiveTokens).toHaveBeenCalled();
            expect(priceProvider.fetchPrices).toHaveBeenCalledWith([mockToken]);
        });
    });
});
