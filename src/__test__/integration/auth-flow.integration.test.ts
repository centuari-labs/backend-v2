// Mock privy modules to prevent jose ESM import chain
jest.mock("../../core/privy/privy.service", () => ({}));
jest.mock("../../common/guards/strategies/privy-auth.strategy", () => ({
    PrivyAuthStrategy: class MockPrivyAuthStrategy {
        async validate() {
            return { userId: "mock", walletAddress: "0xMock" };
        }
        getName() {
            return "privy";
        }
    },
}));

import { Test, TestingModule } from "@nestjs/testing";
import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { AuthGuard } from "../../common/guards/auth.guard";
import { AuthStrategyFactory } from "../../common/guards/strategies/auth-strategy.factory";
import { PrivyAuthStrategy } from "../../common/guards/strategies/privy-auth.strategy";
import type { AuthUser } from "../../common/guards/strategies/auth-strategy.interface";

/**
 * Integration tests for the auth flow:
 * AuthGuard → AuthStrategyFactory → PrivyAuthStrategy
 */
describe("Auth Flow Integration", () => {
    describe("AuthGuard with PrivyAuthStrategy", () => {
        let guard: AuthGuard;
        let privyStrategy: PrivyAuthStrategy;

        function createMockContext(
            headers: Record<string, string> = {},
        ): ExecutionContext {
            const request = {
                headers,
                user: undefined as AuthUser | undefined,
            };
            return {
                switchToHttp: () => ({
                    getRequest: () => request,
                }),
            } as unknown as ExecutionContext;
        }

        beforeEach(async () => {
            const module: TestingModule = await Test.createTestingModule({
                providers: [AuthGuard, AuthStrategyFactory, PrivyAuthStrategy],
            }).compile();

            guard = module.get<AuthGuard>(AuthGuard);
            privyStrategy = module.get<PrivyAuthStrategy>(PrivyAuthStrategy);
        });

        it("should authenticate with valid Privy token", async () => {
            const ctx = createMockContext({
                authorization: "Bearer valid-privy-jwt",
            });

            const result = await guard.canActivate(ctx);

            expect(result).toBe(true);
            const request = ctx.switchToHttp().getRequest();
            expect(request.user).toEqual({
                userId: "mock",
                walletAddress: "0xMock",
            });
        });

        it("should reject missing authorization header", async () => {
            const ctx = createMockContext({});

            await expect(guard.canActivate(ctx)).rejects.toThrow(
                "Authorization header is required",
            );
        });

        it("should reject invalid authorization format", async () => {
            const ctx = createMockContext({
                authorization: "Basic some-token",
            });

            await expect(guard.canActivate(ctx)).rejects.toThrow(
                "Invalid authorization header format",
            );
        });

        it("should reject missing token after Bearer", async () => {
            const ctx = createMockContext({
                authorization: "Bearer ",
            });

            await expect(guard.canActivate(ctx)).rejects.toThrow(
                UnauthorizedException,
            );
        });

        it("should set request.user with walletAddress for @Wallet decorator", async () => {
            const ctx = createMockContext({
                authorization: "Bearer valid-privy-jwt",
            });

            await guard.canActivate(ctx);

            const request = ctx.switchToHttp().getRequest();
            expect(request.user?.walletAddress).toBe("0xMock");
        });

        it("should set request.user with userId for @CurrentUser decorator", async () => {
            const ctx = createMockContext({
                authorization: "Bearer valid-privy-jwt",
            });

            await guard.canActivate(ctx);

            const request = ctx.switchToHttp().getRequest();
            expect(request.user?.userId).toBe("mock");
        });
    });

    describe("AuthStrategyFactory", () => {
        it("should always return PrivyAuthStrategy", () => {
            const privyStrategy = {
                validate: jest.fn(),
                getName: () => "privy",
            } as any;
            const factory = new AuthStrategyFactory(privyStrategy);

            expect(factory.getStrategy()).toBe(privyStrategy);
        });
    });
});
