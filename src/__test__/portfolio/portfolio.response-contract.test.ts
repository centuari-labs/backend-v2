import {
    MyAssetsResponseDto,
    MyAssetItemDto,
} from "src/portfolio/dto/portfolio.dto";
import { ResponseInterceptor } from "src/common/interceptors/response.interceptor";
import { CallHandler, ExecutionContext } from "@nestjs/common";
import { of, lastValueFrom } from "rxjs";

describe("MyAssetsResponseDto contract", () => {
    function buildMyAssetsResponse(
        overrides: Partial<MyAssetsResponseDto> = {},
    ): MyAssetsResponseDto {
        return {
            data: [
                {
                    assetId: "asset-usdc-id",
                    symbol: "USDC",
                    name: "USD Coin",
                    walletBalance: 5000,
                    amountInUsd: 5000,
                    isCollateral: false,
                    imageUrl: "https://example.com/usdc.png",
                    ltv: 0.75,
                    liquidationThreshold: 0.8,
                },
                {
                    assetId: "asset-eth-id",
                    symbol: "ETH",
                    name: "Ethereum",
                    walletBalance: 2.5,
                    amountInUsd: 7500,
                    isCollateral: true,
                    imageUrl: null,
                    ltv: 0.8,
                    liquidationThreshold: 0.82,
                },
            ],
            page: 1,
            limit: 10,
            totalData: 2,
            totalPages: 1,
            ...overrides,
        };
    }

    describe("raw DTO shape", () => {
        it("has data array, page, limit, totalData, totalPages", () => {
            const resp = buildMyAssetsResponse();
            expect(resp).toHaveProperty("data");
            expect(resp).toHaveProperty("page");
            expect(resp).toHaveProperty("limit");
            expect(resp).toHaveProperty("totalData");
            expect(resp).toHaveProperty("totalPages");
        });

        it("data is an array of MyAssetItemDto", () => {
            const resp = buildMyAssetsResponse();
            expect(Array.isArray(resp.data)).toBe(true);
            expect(resp.data).toHaveLength(2);
        });
    });

    describe("MyAssetItemDto fields", () => {
        it("has all required fields", () => {
            const item: MyAssetItemDto = {
                assetId: "asset-usdc-id",
                symbol: "USDC",
                name: "USD Coin",
                walletBalance: 5000,
                amountInUsd: 5000,
                isCollateral: false,
                imageUrl: null,
                ltv: 0.75,
                liquidationThreshold: 0.8,
            };
            expect(item).toHaveProperty("symbol");
            expect(item).toHaveProperty("name");
            expect(item).toHaveProperty("walletBalance");
            expect(item).toHaveProperty("amountInUsd");
            expect(item).toHaveProperty("isCollateral");
            expect(item).toHaveProperty("imageUrl");
        });

        it("imageUrl can be null", () => {
            const resp = buildMyAssetsResponse();
            expect(resp.data[1].imageUrl).toBeNull();
        });

        it("imageUrl can be a string URL", () => {
            const resp = buildMyAssetsResponse();
            expect(resp.data[0].imageUrl).toBe("https://example.com/usdc.png");
        });
    });

    describe("interceptor transform for paginated response", () => {
        let interceptor: ResponseInterceptor<MyAssetsResponseDto>;

        beforeEach(() => {
            interceptor = new ResponseInterceptor();
        });

        function createMockContext(statusCode = 200): ExecutionContext {
            return {
                switchToHttp: () => ({
                    getResponse: () => ({ statusCode }),
                    getRequest: () => ({}),
                }),
                getClass: () => ({}),
                getHandler: () => ({}),
            } as unknown as ExecutionContext;
        }

        it("transforms MyAssetsResponseDto into { statusCode, data: items[], meta }", async () => {
            const rawResponse = buildMyAssetsResponse();
            const ctx = createMockContext(200);
            const handler: CallHandler = { handle: () => of(rawResponse) };

            const result = await lastValueFrom(
                interceptor.intercept(ctx, handler),
            );

            // data should be the inner array, not the full DTO
            expect(result.statusCode).toBe(200);
            expect(Array.isArray(result.data)).toBe(true);
            expect(result.data).toHaveLength(2);
            expect(result.data[0].symbol).toBe("USDC");

            // meta should contain pagination fields
            expect(result.meta).toEqual({
                page: 1,
                limit: 10,
                totalData: 2,
                totalPages: 1,
            });
        });

        it("FE apiClient unwraps outer envelope to get the array", async () => {
            const rawResponse = buildMyAssetsResponse();
            const ctx = createMockContext(200);
            const handler: CallHandler = { handle: () => of(rawResponse) };

            const wireResponse = await lastValueFrom(
                interceptor.intercept(ctx, handler),
            );

            // Simulate FE apiClient: const json = wireResponse; return json.data;
            const feResult = wireResponse.data;

            // FE should get a flat array, not an object with .data
            expect(Array.isArray(feResult)).toBe(true);
            expect(feResult[0]).toHaveProperty("symbol");
            expect(feResult[0]).not.toHaveProperty("page");
        });
    });
});
