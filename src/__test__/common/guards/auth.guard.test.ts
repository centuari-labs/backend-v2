jest.mock("../../../core/privy/privy.service", () => ({}));

import { UnauthorizedException } from "@nestjs/common";
import { AuthGuard } from "../../../common/guards/auth.guard";

describe("AuthGuard", () => {
    let guard: AuthGuard;
    let mockPrivyService: {
        verify: jest.Mock;
        getUser: jest.Mock;
    };

    const createMockExecutionContext = (
        headers: Record<string, string> = {},
    ) => {
        const request: any = { headers, user: undefined };
        return {
            switchToHttp: () => ({
                getRequest: () => request,
            }),
            _request: request,
        };
    };

    beforeEach(() => {
        mockPrivyService = {
            verify: jest.fn(),
            getUser: jest.fn(),
        };
        guard = new AuthGuard(mockPrivyService as any);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("canActivate", () => {
        it("should throw UnauthorizedException when no authorization header", async () => {
            const context = createMockExecutionContext({});

            await expect(guard.canActivate(context as any)).rejects.toThrow(
                UnauthorizedException,
            );
            await expect(guard.canActivate(context as any)).rejects.toThrow(
                "Authorization header is required",
            );
        });

        it("should throw UnauthorizedException when authorization is not Bearer", async () => {
            const context = createMockExecutionContext({
                authorization: "Basic abc123",
            });

            await expect(guard.canActivate(context as any)).rejects.toThrow(
                UnauthorizedException,
            );
            await expect(guard.canActivate(context as any)).rejects.toThrow(
                "Invalid authorization header format",
            );
        });

        it("should throw UnauthorizedException when Bearer has no token", async () => {
            const context = createMockExecutionContext({
                authorization: "Bearer ",
            });

            await expect(guard.canActivate(context as any)).rejects.toThrow(
                UnauthorizedException,
            );
        });

        it("should throw UnauthorizedException when token verification fails", async () => {
            const context = createMockExecutionContext({
                authorization: "Bearer invalid-token",
            });
            mockPrivyService.verify.mockRejectedValue(
                new Error("Invalid token"),
            );

            await expect(guard.canActivate(context as any)).rejects.toThrow(
                UnauthorizedException,
            );
            await expect(guard.canActivate(context as any)).rejects.toThrow(
                "Invalid or expired token",
            );
        });

        it("should set request.user and return true for valid token with wallet", async () => {
            const context = createMockExecutionContext({
                authorization: "Bearer valid-token",
            });

            mockPrivyService.verify.mockResolvedValue({
                userId: "did:privy:user123",
            });
            mockPrivyService.getUser.mockResolvedValue({
                linkedAccounts: [
                    { type: "wallet", address: "0xWalletAddress123" },
                ],
            });

            const result = await guard.canActivate(context as any);

            expect(result).toBe(true);
            expect(context._request.user).toEqual({
                userId: "did:privy:user123",
                walletAddress: "0xWalletAddress123",
            });
        });

        it("should fallback to userId when user has no wallet linked account", async () => {
            const context = createMockExecutionContext({
                authorization: "Bearer valid-token",
            });

            mockPrivyService.verify.mockResolvedValue({
                userId: "did:privy:user123",
            });
            mockPrivyService.getUser.mockResolvedValue({
                linkedAccounts: [{ type: "email", address: "test@test.com" }],
            });

            const result = await guard.canActivate(context as any);

            expect(result).toBe(true);
            expect(context._request.user.walletAddress).toBe(
                "did:privy:user123",
            );
        });

        it("should fallback to userId when getUser throws", async () => {
            const context = createMockExecutionContext({
                authorization: "Bearer valid-token",
            });

            mockPrivyService.verify.mockResolvedValue({
                userId: "did:privy:user123",
            });
            mockPrivyService.getUser.mockRejectedValue(
                new Error("Privy API error"),
            );

            const result = await guard.canActivate(context as any);

            expect(result).toBe(true);
            expect(context._request.user.walletAddress).toBe(
                "did:privy:user123",
            );
        });

        it("should fallback to userId when wallet account has no address", async () => {
            const context = createMockExecutionContext({
                authorization: "Bearer valid-token",
            });

            mockPrivyService.verify.mockResolvedValue({
                userId: "did:privy:user123",
            });
            mockPrivyService.getUser.mockResolvedValue({
                linkedAccounts: [{ type: "wallet" }],
            });

            const result = await guard.canActivate(context as any);

            expect(result).toBe(true);
            expect(context._request.user.walletAddress).toBe(
                "did:privy:user123",
            );
        });
    });
});
