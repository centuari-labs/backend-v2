import { UnauthorizedException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { AuthStrategyFactory } from "../../../../common/guards/strategies/auth-strategy.factory";
import type { IAuthStrategy } from "../../../../common/guards/strategies/auth-strategy.interface";
import { RequestAuthService } from "../../../../common/guards/strategies/request-auth.service";

// Mock jose and PrivyService to avoid jose ESM import issues
jest.mock("jose", () => ({}));
jest.mock("../../../../core/privy/privy.service");

interface MockRequest {
    headers: { authorization?: string };
}

describe("RequestAuthService", () => {
    let service: RequestAuthService;
    let mockStrategy: jest.Mocked<IAuthStrategy>;

    const createRequest = (authHeader?: string): MockRequest => ({
        headers: { authorization: authHeader },
    });

    beforeEach(async () => {
        mockStrategy = {
            validate: jest.fn(),
            verifyPrincipal: jest.fn(),
            resolveAuthUser: jest.fn(),
            getName: jest.fn().mockReturnValue("mock"),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                RequestAuthService,
                {
                    provide: AuthStrategyFactory,
                    useValue: { getStrategy: jest.fn(() => mockStrategy) },
                },
            ],
        }).compile();

        service = module.get<RequestAuthService>(RequestAuthService);
    });

    describe("getPrincipal", () => {
        it("returns the principal for a valid token and memoizes it", async () => {
            mockStrategy.verifyPrincipal.mockResolvedValue({
                userId: "did:privy:abc",
            });
            const request = createRequest("Bearer valid.jwt.token");

            const first = await service.getPrincipal(request);
            const second = await service.getPrincipal(request);

            expect(first).toEqual({ userId: "did:privy:abc" });
            expect(second).toEqual({ userId: "did:privy:abc" });
            expect(mockStrategy.verifyPrincipal).toHaveBeenCalledTimes(1);
        });

        it("returns null without throwing when no Authorization header", async () => {
            const request = createRequest();

            await expect(service.getPrincipal(request)).resolves.toBeNull();
            expect(mockStrategy.verifyPrincipal).not.toHaveBeenCalled();
        });

        it("returns null and memoizes failure for an invalid token", async () => {
            mockStrategy.verifyPrincipal.mockRejectedValue(
                new UnauthorizedException("Invalid token"),
            );
            const request = createRequest("Bearer bad.jwt.token");

            await expect(service.getPrincipal(request)).resolves.toBeNull();
            await expect(service.getPrincipal(request)).resolves.toBeNull();
            expect(mockStrategy.verifyPrincipal).toHaveBeenCalledTimes(1);
        });

        it("returns null for a malformed Authorization header", async () => {
            const request = createRequest("NotBearer something");

            await expect(service.getPrincipal(request)).resolves.toBeNull();
            expect(mockStrategy.verifyPrincipal).not.toHaveBeenCalled();
        });
    });

    describe("getAuthUser", () => {
        it("verifies once across both stages on the same request (AE4)", async () => {
            mockStrategy.verifyPrincipal.mockResolvedValue({
                userId: "did:privy:abc",
            });
            mockStrategy.resolveAuthUser.mockResolvedValue({
                userId: "did:privy:abc",
                walletAddress: "0xabc",
            });
            const request = createRequest("Bearer valid.jwt.token");

            // Tracker runs first (global guard), then AuthGuard.
            await service.getPrincipal(request);
            const user = await service.getAuthUser(request);

            expect(user).toEqual({
                userId: "did:privy:abc",
                walletAddress: "0xabc",
            });
            expect(mockStrategy.verifyPrincipal).toHaveBeenCalledTimes(1);
            expect(mockStrategy.resolveAuthUser).toHaveBeenCalledTimes(1);
        });

        it("works standalone when the tracker never ran", async () => {
            mockStrategy.verifyPrincipal.mockResolvedValue({
                userId: "did:privy:xyz",
            });
            mockStrategy.resolveAuthUser.mockResolvedValue({
                userId: "did:privy:xyz",
                walletAddress: "0xdef",
            });
            const request = createRequest("Bearer valid.jwt.token");

            const user = await service.getAuthUser(request);

            expect(user.walletAddress).toBe("0xdef");
            expect(mockStrategy.verifyPrincipal).toHaveBeenCalledTimes(1);
        });

        it("throws UnauthorizedException when the header is missing", async () => {
            const request = createRequest();

            await expect(service.getAuthUser(request)).rejects.toThrow(
                UnauthorizedException,
            );
        });

        it("throws when the principal failed verification", async () => {
            mockStrategy.verifyPrincipal.mockRejectedValue(
                new UnauthorizedException("Invalid token"),
            );
            const request = createRequest("Bearer bad.jwt.token");

            await expect(service.getAuthUser(request)).rejects.toThrow(
                UnauthorizedException,
            );
            expect(mockStrategy.resolveAuthUser).not.toHaveBeenCalled();
        });

        it("memoizes failure: rethrows without re-resolving (fail-closed kept)", async () => {
            mockStrategy.verifyPrincipal.mockResolvedValue({
                userId: "did:privy:abc",
            });
            mockStrategy.resolveAuthUser.mockRejectedValue(
                new UnauthorizedException("No wallet linked"),
            );
            const request = createRequest("Bearer valid.jwt.token");

            await expect(service.getAuthUser(request)).rejects.toThrow(
                "No wallet linked",
            );
            await expect(service.getAuthUser(request)).rejects.toThrow(
                "No wallet linked",
            );
            expect(mockStrategy.resolveAuthUser).toHaveBeenCalledTimes(1);
        });
    });
});
