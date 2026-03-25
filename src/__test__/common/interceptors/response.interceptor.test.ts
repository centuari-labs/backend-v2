import { of } from "rxjs";
import { ResponseInterceptor } from "../../../common/interceptors/response.interceptor";

describe("ResponseInterceptor", () => {
    let interceptor: ResponseInterceptor;

    const createMockContext = (statusCode: number) => ({
        switchToHttp: () => ({
            getResponse: () => ({ statusCode }),
        }),
    });

    const createMockCallHandler = (data: any) => ({
        handle: () => of(data),
    });

    beforeEach(() => {
        interceptor = new ResponseInterceptor();
    });

    describe("intercept", () => {
        it("should wrap response data with statusCode", (done) => {
            const context = createMockContext(200);
            const handler = createMockCallHandler({ message: "hello" });

            interceptor.intercept(context as any, handler as any).subscribe({
                next: (result) => {
                    expect(result).toEqual({
                        statusCode: 200,
                        data: { message: "hello" },
                    });
                    done();
                },
            });
        });

        it("should wrap with 201 for created responses", (done) => {
            const context = createMockContext(201);
            const handler = createMockCallHandler({ id: "123" });

            interceptor.intercept(context as any, handler as any).subscribe({
                next: (result) => {
                    expect(result.statusCode).toBe(201);
                    expect(result.data).toEqual({ id: "123" });
                    done();
                },
            });
        });

        it("should handle null data", (done) => {
            const context = createMockContext(200);
            const handler = createMockCallHandler(null);

            interceptor.intercept(context as any, handler as any).subscribe({
                next: (result) => {
                    expect(result).toEqual({ statusCode: 200, data: null });
                    done();
                },
            });
        });

        it("should handle array data", (done) => {
            const context = createMockContext(200);
            const handler = createMockCallHandler([1, 2, 3]);

            interceptor.intercept(context as any, handler as any).subscribe({
                next: (result) => {
                    expect(result).toEqual({
                        statusCode: 200,
                        data: [1, 2, 3],
                    });
                    done();
                },
            });
        });

        it("should handle string data", (done) => {
            const context = createMockContext(200);
            const handler = createMockCallHandler("Hello World!");

            interceptor.intercept(context as any, handler as any).subscribe({
                next: (result) => {
                    expect(result).toEqual({
                        statusCode: 200,
                        data: "Hello World!",
                    });
                    done();
                },
            });
        });
    });
});
