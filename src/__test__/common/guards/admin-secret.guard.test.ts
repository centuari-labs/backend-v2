import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { AdminSecretGuard } from "../../../common/guards/admin-secret.guard";
import { createMockConfigService } from "../../helpers/mock-services";

describe("AdminSecretGuard", () => {
    let guard: AdminSecretGuard;
    let mockConfigService: ReturnType<typeof createMockConfigService>;

    const createMockExecutionContext = (
        authHeader?: string,
    ): ExecutionContext => {
        const mockRequest = {
            headers: {
                authorization: authHeader,
            },
        };
        return {
            switchToHttp: () => ({
                getRequest: () => mockRequest,
            }),
        } as ExecutionContext;
    };

    beforeEach(() => {
        mockConfigService = createMockConfigService({
            ACCESS_CODE_ADMIN_SECRET: "my-admin-secret",
        });
        guard = new AdminSecretGuard(mockConfigService as any);
    });

    describe("canActivate", () => {
        it("should return true when valid Bearer token matches configured secret", () => {
            const context = createMockExecutionContext(
                "Bearer my-admin-secret",
            );
            expect(guard.canActivate(context)).toBe(true);
        });

        it("should throw UnauthorizedException when Authorization header is missing", () => {
            const context = createMockExecutionContext();
            expect(() => guard.canActivate(context)).toThrow(
                UnauthorizedException,
            );
            expect(() => guard.canActivate(context)).toThrow(
                "Missing admin secret",
            );
        });

        it("should throw UnauthorizedException when Bearer prefix is missing", () => {
            const context = createMockExecutionContext("Basic my-admin-secret");
            expect(() => guard.canActivate(context)).toThrow(
                UnauthorizedException,
            );
            expect(() => guard.canActivate(context)).toThrow(
                "Missing admin secret",
            );
        });

        it("should throw UnauthorizedException when token does not match secret", () => {
            const context = createMockExecutionContext("Bearer wrong-secret");
            expect(() => guard.canActivate(context)).toThrow(
                UnauthorizedException,
            );
            expect(() => guard.canActivate(context)).toThrow(
                "Invalid admin secret",
            );
        });

        it("should throw UnauthorizedException when ACCESS_CODE_ADMIN_SECRET is not configured", () => {
            mockConfigService = createMockConfigService({});
            guard = new AdminSecretGuard(mockConfigService as any);

            const context = createMockExecutionContext("Bearer some-token");
            expect(() => guard.canActivate(context)).toThrow(
                UnauthorizedException,
            );
            expect(() => guard.canActivate(context)).toThrow(
                "Invalid admin secret",
            );
        });

        it("should throw UnauthorizedException when token is empty after Bearer", () => {
            const context = createMockExecutionContext("Bearer ");
            expect(() => guard.canActivate(context)).toThrow(
                UnauthorizedException,
            );
        });
    });
});
