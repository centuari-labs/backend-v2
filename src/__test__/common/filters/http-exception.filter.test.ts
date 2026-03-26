import {
    BadRequestException,
    HttpException,
    HttpStatus,
    NotFoundException,
} from "@nestjs/common";
import { AllExceptionsFilter } from "../../../common/filters/http-exception.filter";

describe("AllExceptionsFilter", () => {
    let filter: AllExceptionsFilter;
    let mockJson: jest.Mock;
    let mockStatus: jest.Mock;
    let mockHost: any;

    beforeEach(() => {
        filter = new AllExceptionsFilter();
        mockJson = jest.fn();
        mockStatus = jest.fn().mockReturnValue({ json: mockJson });

        mockHost = {
            switchToHttp: () => ({
                getResponse: () => ({ status: mockStatus }),
                getRequest: () => ({ url: "/test/path" }),
            }),
        };
    });

    it("should handle HttpException with correct status code", () => {
        const exception = new BadRequestException("Bad input");

        filter.catch(exception, mockHost);

        expect(mockStatus).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    });

    it("should handle HttpException and return structured response", () => {
        const exception = new NotFoundException("Not found");

        filter.catch(exception, mockHost);

        expect(mockJson).toHaveBeenCalledWith(
            expect.objectContaining({
                success: false,
                statusCode: HttpStatus.NOT_FOUND,
                path: "/test/path",
            }),
        );
    });

    it("should include timestamp in response", () => {
        const exception = new BadRequestException("Bad");

        filter.catch(exception, mockHost);

        const response = mockJson.mock.calls[0][0];
        expect(response.timestamp).toBeDefined();
        expect(typeof response.timestamp).toBe("string");
    });

    it("should handle non-HttpException as 500 Internal Server Error", () => {
        const exception = new Error("Unexpected failure");

        filter.catch(exception, mockHost);

        expect(mockStatus).toHaveBeenCalledWith(
            HttpStatus.INTERNAL_SERVER_ERROR,
        );
    });

    it("should include error message and stack for non-HttpException", () => {
        const exception = new Error("DB crashed");

        filter.catch(exception, mockHost);

        const response = mockJson.mock.calls[0][0];
        expect(response.message).toContain("DB crashed");
        expect(response.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
        expect(response.success).toBe(false);
    });

    it("should use HttpException.getResponse() as message for HttpException", () => {
        const exception = new HttpException(
            { message: "Custom error", details: "stuff" },
            422,
        );

        filter.catch(exception, mockHost);

        const response = mockJson.mock.calls[0][0];
        expect(response.message).toEqual({
            message: "Custom error",
            details: "stuff",
        });
        expect(mockStatus).toHaveBeenCalledWith(422);
    });

    it("should include request path in response", () => {
        const customHost = {
            switchToHttp: () => ({
                getResponse: () => ({ status: mockStatus }),
                getRequest: () => ({ url: "/api/orders/123/cancel" }),
            }),
        };

        filter.catch(new Error("fail"), customHost);

        const response = mockJson.mock.calls[0][0];
        expect(response.path).toBe("/api/orders/123/cancel");
    });
});
