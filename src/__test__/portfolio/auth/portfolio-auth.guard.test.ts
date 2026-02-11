import { Test, TestingModule } from "@nestjs/testing";
import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { PortfolioAuthGuard } from "../../../portfolio/auth/portfolio-auth.guard";
import { PortfolioAuthStrategyFactory } from "../../../portfolio/auth/auth-strategy.factory";
import type { IAuthStrategy } from "../../../portfolio/auth/strategies/auth-strategy.interface";

describe("PortfolioAuthGuard", () => {
    let guard: PortfolioAuthGuard;
    let strategyFactory: jest.Mocked<PortfolioAuthStrategyFactory>;
    let mockStrategy: jest.Mocked<IAuthStrategy>;

    beforeEach(async () => {
        mockStrategy = {
            validate: jest.fn(),
            getName: jest.fn().mockReturnValue("mock"),
        };

        const mockStrategyFactory = {
            getStrategy: jest.fn().mockReturnValue(mockStrategy),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PortfolioAuthGuard,
                {
                    provide: PortfolioAuthStrategyFactory,
                    useValue: mockStrategyFactory,
                },
            ],
        }).compile();

        guard = module.get<PortfolioAuthGuard>(PortfolioAuthGuard);
        strategyFactory = module.get(PortfolioAuthStrategyFactory);
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

    describe("canActivate", () => {
        it("should return true and set request.user when valid Bearer token provided", async () => {
            const mockToken = "valid-token";
            const mockAuthUser = {
                userId: "user-123",
                walletAddress: "0x123",
            };

            mockStrategy.validate.mockResolvedValue(mockAuthUser);

            const context = createMockExecutionContext(`Bearer ${mockToken}`);
            const result = await guard.canActivate(context);

            expect(result).toBe(true);
            expect(mockStrategy.validate).toHaveBeenCalledWith(mockToken);

            const request = context.switchToHttp().getRequest();
            expect(request.user).toEqual(mockAuthUser);
        });

        it("should throw UnauthorizedException when Authorization header is missing", async () => {
            const context = createMockExecutionContext();

            await expect(guard.canActivate(context)).rejects.toThrow(
                UnauthorizedException,
            );
            await expect(guard.canActivate(context)).rejects.toThrow(
                "Authorization header required",
            );
        });

        it("should throw UnauthorizedException when Bearer prefix is missing", async () => {
            const context = createMockExecutionContext("InvalidToken");

            await expect(guard.canActivate(context)).rejects.toThrow(
                UnauthorizedException,
            );
            await expect(guard.canActivate(context)).rejects.toThrow(
                "Invalid authorization format",
            );
        });

        it("should throw UnauthorizedException when token is empty after Bearer", async () => {
            const context = createMockExecutionContext("Bearer ");

            await expect(guard.canActivate(context)).rejects.toThrow(
                UnauthorizedException,
            );
        });

        it("should throw UnauthorizedException when strategy validation fails", async () => {
            mockStrategy.validate.mockRejectedValue(
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

        it("should use strategy from factory", async () => {
            const mockToken = "test-token";
            const mockAuthUser = {
                userId: "user-456",
                walletAddress: "0x456",
            };

            mockStrategy.validate.mockResolvedValue(mockAuthUser);

            const context = createMockExecutionContext(`Bearer ${mockToken}`);
            await guard.canActivate(context);

            expect(strategyFactory.getStrategy).toHaveBeenCalled();
            expect(mockStrategy.validate).toHaveBeenCalledWith(mockToken);
        });
    });
});
