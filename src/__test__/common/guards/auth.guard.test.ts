import { Test, TestingModule } from "@nestjs/testing";
import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { AuthGuard } from "../../../common/guards/auth.guard";
import { AuthStrategyFactory } from "../../../common/guards/strategies/auth-strategy.factory";
import type { IAuthStrategy } from "../../../common/guards/strategies/auth-strategy.interface";
import { RequestAuthService } from "../../../common/guards/strategies/request-auth.service";

// Mock jose and PrivyService to avoid jose ESM import issues
jest.mock("jose", () => ({}));
jest.mock("../../../core/privy/privy.service");

describe("AuthGuard", () => {
    let guard: AuthGuard;
    let requestAuth: RequestAuthService;
    let mockStrategy: jest.Mocked<IAuthStrategy>;

    beforeEach(async () => {
        mockStrategy = {
            validate: jest.fn(),
            verifyPrincipal: jest.fn(),
            resolveAuthUser: jest.fn(),
            getName: jest.fn().mockReturnValue("mock"),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AuthGuard,
                RequestAuthService,
                {
                    provide: AuthStrategyFactory,
                    useValue: { getStrategy: jest.fn(() => mockStrategy) },
                },
            ],
        }).compile();

        guard = module.get<AuthGuard>(AuthGuard);
        requestAuth = module.get<RequestAuthService>(RequestAuthService);
    });

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

    const mockValidToken = (userId: string, walletAddress: string) => {
        mockStrategy.verifyPrincipal.mockResolvedValue({ userId });
        mockStrategy.resolveAuthUser.mockResolvedValue({
            userId,
            walletAddress,
        });
    };

    describe("canActivate", () => {
        it("should return true and set request.user when valid Bearer token provided", async () => {
            mockValidToken("user-123", "0x123");

            const context = createMockExecutionContext("Bearer valid-token");
            const result = await guard.canActivate(context);

            expect(result).toBe(true);
            expect(mockStrategy.verifyPrincipal).toHaveBeenCalledWith(
                "valid-token",
            );

            const request = context.switchToHttp().getRequest();
            expect(request.user).toEqual({
                userId: "user-123",
                walletAddress: "0x123",
            });
        });

        it("should verify exactly once when the throttler tracker ran first (AE4)", async () => {
            mockValidToken("user-123", "0x123");

            const context = createMockExecutionContext("Bearer valid-token");
            const request = context.switchToHttp().getRequest();

            // Simulate the global WalletThrottlerGuard resolving the bucket
            // key before AuthGuard runs on the same request.
            await requestAuth.getPrincipal(request);
            await guard.canActivate(context);

            expect(mockStrategy.verifyPrincipal).toHaveBeenCalledTimes(1);
            expect(mockStrategy.resolveAuthUser).toHaveBeenCalledTimes(1);
        });

        it("should throw UnauthorizedException when Authorization header is missing", async () => {
            const context = createMockExecutionContext();

            await expect(guard.canActivate(context)).rejects.toThrow(
                UnauthorizedException,
            );
            await expect(guard.canActivate(context)).rejects.toThrow(
                "Authorization header is required",
            );
        });

        it("should throw UnauthorizedException when Bearer prefix is missing", async () => {
            const context = createMockExecutionContext("InvalidToken");

            await expect(guard.canActivate(context)).rejects.toThrow(
                UnauthorizedException,
            );
            await expect(guard.canActivate(context)).rejects.toThrow(
                "Invalid authorization header format",
            );
        });

        it("should throw UnauthorizedException when token is empty after Bearer", async () => {
            const context = createMockExecutionContext("Bearer ");

            await expect(guard.canActivate(context)).rejects.toThrow(
                UnauthorizedException,
            );
        });

        it("should respond with the same generic message when validation fails", async () => {
            mockStrategy.verifyPrincipal.mockRejectedValue(
                new UnauthorizedException("Invalid token"),
            );

            const context = createMockExecutionContext("Bearer invalid-token");

            await expect(guard.canActivate(context)).rejects.toThrow(
                UnauthorizedException,
            );
            await expect(guard.canActivate(context)).rejects.toThrow(
                "Invalid or expired token",
            );
        });

        it("should fail closed when wallet resolution fails", async () => {
            mockStrategy.verifyPrincipal.mockResolvedValue({
                userId: "user-123",
            });
            mockStrategy.resolveAuthUser.mockRejectedValue(
                new UnauthorizedException("No wallet linked"),
            );

            const context = createMockExecutionContext("Bearer valid-token");

            await expect(guard.canActivate(context)).rejects.toThrow(
                "Invalid or expired token",
            );
        });
    });
});
