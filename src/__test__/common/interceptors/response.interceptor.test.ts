import { of } from "rxjs";
import { ResponseInterceptor } from "../../../common/interceptors/response.interceptor";

describe("ResponseInterceptor", () => {
    let interceptor: ResponseInterceptor;

    beforeEach(() => {
        interceptor = new ResponseInterceptor();
    });

    function createContext(statusCode: number) {
        return {
            switchToHttp: () => ({
                getResponse: () => ({ statusCode }),
            }),
        } as any;
    }

    function createCallHandler(data: unknown) {
        return {
            handle: () => of(data),
        } as any;
    }

    it("should wrap response data with statusCode", (done) => {
        const context = createContext(200);
        const handler = createCallHandler({ name: "test" });

        interceptor.intercept(context, handler).subscribe((result) => {
            expect(result).toEqual({
                statusCode: 200,
                data: { name: "test" },
            });
            done();
        });
    });

    it("should wrap with 201 status code for created resources", (done) => {
        const context = createContext(201);
        const handler = createCallHandler({ id: "order-1" });

        interceptor.intercept(context, handler).subscribe((result) => {
            expect(result).toEqual({
                statusCode: 201,
                data: { id: "order-1" },
            });
            done();
        });
    });

    it("should handle null data", (done) => {
        const context = createContext(200);
        const handler = createCallHandler(null);

        interceptor.intercept(context, handler).subscribe((result) => {
            expect(result).toEqual({
                statusCode: 200,
                data: null,
            });
            done();
        });
    });

    it("should handle string data", (done) => {
        const context = createContext(200);
        const handler = createCallHandler("Hello World!");

        interceptor.intercept(context, handler).subscribe((result) => {
            expect(result).toEqual({
                statusCode: 200,
                data: "Hello World!",
            });
            done();
        });
    });

    it("should handle array data", (done) => {
        const context = createContext(200);
        const handler = createCallHandler([1, 2, 3]);

        interceptor.intercept(context, handler).subscribe((result) => {
            expect(result).toEqual({
                statusCode: 200,
                data: [1, 2, 3],
            });
            done();
        });
    });

    it("should handle empty object data", (done) => {
        const context = createContext(200);
        const handler = createCallHandler({});

        interceptor.intercept(context, handler).subscribe((result) => {
            expect(result).toEqual({
                statusCode: 200,
                data: {},
            });
            done();
        });
    });
});
