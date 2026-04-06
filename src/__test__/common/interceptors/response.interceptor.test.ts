import { ResponseInterceptor } from "src/common/interceptors/response.interceptor";
import { CallHandler, ExecutionContext } from "@nestjs/common";
import { of } from "rxjs";
import { lastValueFrom } from "rxjs";

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

function createMockCallHandler(result: unknown): CallHandler {
    return { handle: () => of(result) };
}

describe("ResponseInterceptor", () => {
    let interceptor: ResponseInterceptor<any>;

    beforeEach(() => {
        interceptor = new ResponseInterceptor();
    });

    it("wraps a plain object in { statusCode, data }", async () => {
        const ctx = createMockContext(200);
        const handler = createMockCallHandler({ foo: "bar" });

        const result = await lastValueFrom(interceptor.intercept(ctx, handler));

        expect(result).toEqual({
            statusCode: 200,
            data: { foo: "bar" },
        });
    });

    it("wraps null result in { statusCode, data: null }", async () => {
        const ctx = createMockContext(200);
        const handler = createMockCallHandler(null);

        const result = await lastValueFrom(interceptor.intercept(ctx, handler));

        expect(result).toEqual({ statusCode: 200, data: null });
    });

    it("wraps an array in { statusCode, data: [...] }", async () => {
        const ctx = createMockContext(200);
        const handler = createMockCallHandler([1, 2, 3]);

        const result = await lastValueFrom(interceptor.intercept(ctx, handler));

        expect(result).toEqual({ statusCode: 200, data: [1, 2, 3] });
    });

    it("extracts paginated response (data + page) into { statusCode, data, meta }", async () => {
        const paginatedResult = {
            data: [{ id: 1 }, { id: 2 }],
            page: 1,
            limit: 10,
            totalData: 2,
            totalPages: 1,
        };
        const ctx = createMockContext(200);
        const handler = createMockCallHandler(paginatedResult);

        const result = await lastValueFrom(interceptor.intercept(ctx, handler));

        expect(result).toEqual({
            statusCode: 200,
            data: [{ id: 1 }, { id: 2 }],
            meta: {
                page: 1,
                limit: 10,
                totalData: 2,
                totalPages: 1,
            },
        });
    });

    it("does NOT extract when object has 'data' but no 'page'", async () => {
        const objectWithData = { data: [1, 2], extra: "info" };
        const ctx = createMockContext(200);
        const handler = createMockCallHandler(objectWithData);

        const result = await lastValueFrom(interceptor.intercept(ctx, handler));

        // Wrapped normally since there's no 'page' key
        expect(result).toEqual({
            statusCode: 200,
            data: { data: [1, 2], extra: "info" },
        });
    });

    it("preserves 201 status code", async () => {
        const ctx = createMockContext(201);
        const handler = createMockCallHandler({ id: "abc" });

        const result = await lastValueFrom(interceptor.intercept(ctx, handler));

        expect(result).toEqual({
            statusCode: 201,
            data: { id: "abc" },
        });
    });

    it("wraps string result", async () => {
        const ctx = createMockContext(200);
        const handler = createMockCallHandler("hello");

        const result = await lastValueFrom(interceptor.intercept(ctx, handler));

        expect(result).toEqual({ statusCode: 200, data: "hello" });
    });

    it("wraps order-style double envelope (statusCode + data inner)", async () => {
        // OrderResponse returned by controller: { statusCode: 201, data: { orderId, ... } }
        const orderResponse = {
            statusCode: 201,
            data: { orderId: "abc-123", rate: 5 },
        };
        const ctx = createMockContext(201);
        const handler = createMockCallHandler(orderResponse);

        const result = await lastValueFrom(interceptor.intercept(ctx, handler));

        // Since orderResponse has no 'page' key, it's wrapped normally
        // This produces the double envelope: { statusCode: 201, data: { statusCode: 201, data: {...} } }
        expect(result).toEqual({
            statusCode: 201,
            data: {
                statusCode: 201,
                data: { orderId: "abc-123", rate: 5 },
            },
        });
    });
});
