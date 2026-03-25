import {
    BadRequestException,
    HttpException,
    HttpStatus,
    NotFoundException,
} from "@nestjs/common";
import { AllExceptionsFilter } from "../../../common/filters/http-exception.filter";

describe("AllExceptionsFilter", () => {
    let filter: AllExceptionsFilter;

    const createMockArgumentsHost = () => {
        const jsonFn = jest.fn();
        const statusFn = jest.fn().mockReturnValue({ json: jsonFn });
        const response = { status: statusFn };
        const request = { url: "/test/path" };

        return {
            switchToHttp: () => ({
                getResponse: () => response,
                getRequest: () => request,
            }),
            _statusFn: statusFn,
            _jsonFn: jsonFn,
        };
    };

    beforeEach(() => {
        filter = new AllExceptionsFilter();
    });

    describe("catch", () => {
        it("should handle HttpException with correct status", () => {
            const host = createMockArgumentsHost();
            const exception = new BadRequestException("Bad input");

            filter.catch(exception, host as any);

            expect(host._statusFn).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
            expect(host._jsonFn).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: false,
                    statusCode: HttpStatus.BAD_REQUEST,
                    path: "/test/path",
                }),
            );
        });

        it("should handle NotFoundException", () => {
            const host = createMockArgumentsHost();
            const exception = new NotFoundException("Not found");

            filter.catch(exception, host as any);

            expect(host._statusFn).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
        });

        it("should handle non-HttpException as 500", () => {
            const host = createMockArgumentsHost();
            const exception = new Error("Unexpected error");

            filter.catch(exception, host as any);

            expect(host._statusFn).toHaveBeenCalledWith(
                HttpStatus.INTERNAL_SERVER_ERROR,
            );
            expect(host._jsonFn).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: false,
                    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
                }),
            );
        });

        it("should include error message and stack for non-HttpException", () => {
            const host = createMockArgumentsHost();
            const exception = new Error("Crash");

            filter.catch(exception, host as any);

            const jsonCall = host._jsonFn.mock.calls[0][0];
            expect(jsonCall.message).toContain("Internal server error: Crash");
        });

        it("should include HttpException response as message", () => {
            const host = createMockArgumentsHost();
            const exception = new HttpException(
                { message: "Custom error", extra: "data" },
                HttpStatus.FORBIDDEN,
            );

            filter.catch(exception, host as any);

            expect(host._statusFn).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
            const jsonCall = host._jsonFn.mock.calls[0][0];
            expect(jsonCall.message).toEqual(
                expect.objectContaining({ message: "Custom error" }),
            );
        });

        it("should include timestamp in ISO format", () => {
            const host = createMockArgumentsHost();
            const exception = new BadRequestException("test");

            filter.catch(exception, host as any);

            const jsonCall = host._jsonFn.mock.calls[0][0];
            expect(jsonCall.timestamp).toBeDefined();
            expect(() => new Date(jsonCall.timestamp)).not.toThrow();
        });

        it("should include request path", () => {
            const host = createMockArgumentsHost();
            const exception = new BadRequestException("test");

            filter.catch(exception, host as any);

            const jsonCall = host._jsonFn.mock.calls[0][0];
            expect(jsonCall.path).toBe("/test/path");
        });
    });
});
