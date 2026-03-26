jest.mock("../../../core/privy/privy.service", () => ({}));

import { UnauthorizedException } from "@nestjs/common";
import { AuthGuard } from "../../../common/guards/auth.guard";
import {
    createMockExecutionContext,
    createMockPrivyService,
} from "../../helpers/mock-services";

describe("AuthGuard", () => {
    let guard: AuthGuard;
    let privyService: ReturnType<typeof createMockPrivyService>;

    beforeEach(() => {
        privyService = createMockPrivyService();
        guard = new AuthGuard(privyService as any);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it("should throw UnauthorizedException when no authorization header", async () => {
        const context = createMockExecutionContext({ headers: {} });

        await expect(guard.canActivate(context as any)).rejects.toThrow(
            UnauthorizedException,
        );
    });

    it("should throw UnauthorizedException with correct message when no header", async () => {
        const context = createMockExecutionContext({ headers: {} });

        await expect(guard.canActivate(context as any)).rejects.toThrow(
            "Authorization header is required",
        );
    });

    it("should throw UnauthorizedException when header is not Bearer format", async () => {
        const context = createMockExecutionContext({
            headers: { authorization: "Basic abc123" },
        });

        await expect(guard.canActivate(context as any)).rejects.toThrow(
            UnauthorizedException,
        );
    });

    it("should throw UnauthorizedException when token is empty after Bearer", async () => {
        const context = createMockExecutionContext({
            headers: { authorization: "Bearer " },
        });

        await expect(guard.canActivate(context as any)).rejects.toThrow(
            UnauthorizedException,
        );
    });

    it("should throw UnauthorizedException when privy verify fails", async () => {
        const context = createMockExecutionContext({
            headers: { authorization: "Bearer valid-token" },
        });
        privyService.verify.mockRejectedValue(new Error("Token expired"));

        await expect(guard.canActivate(context as any)).rejects.toThrow(
            UnauthorizedException,
        );
    });

    it('should throw UnauthorizedException with "Invalid or expired token" on verify failure', async () => {
        const context = createMockExecutionContext({
            headers: { authorization: "Bearer bad-token" },
        });
        privyService.verify.mockRejectedValue(new Error("Invalid"));

        await expect(guard.canActivate(context as any)).rejects.toThrow(
            "Invalid or expired token",
        );
    });

    it("should return true and attach user when token is valid with wallet account", async () => {
        const mockRequest = {
            headers: { authorization: "Bearer valid-token" },
            user: undefined as any,
        };
        const context = {
            switchToHttp: () => ({
                getRequest: () => mockRequest,
            }),
        };

        privyService.verify.mockResolvedValue({ userId: "user-123" });
        privyService.getUser.mockResolvedValue({
            linkedAccounts: [{ type: "wallet", address: "0xWalletAddress123" }],
        });

        const result = await guard.canActivate(context as any);

        expect(result).toBe(true);
        expect(mockRequest.user).toEqual({
            userId: "user-123",
            walletAddress: "0xWalletAddress123",
        });
    });

    it("should fall back to userId when no wallet in linked accounts", async () => {
        const mockRequest = {
            headers: { authorization: "Bearer valid-token" },
            user: undefined as any,
        };
        const context = {
            switchToHttp: () => ({
                getRequest: () => mockRequest,
            }),
        };

        privyService.verify.mockResolvedValue({ userId: "user-456" });
        privyService.getUser.mockResolvedValue({
            linkedAccounts: [{ type: "email", address: "test@example.com" }],
        });

        const result = await guard.canActivate(context as any);

        expect(result).toBe(true);
        expect(mockRequest.user.walletAddress).toBe("user-456");
    });

    it("should fall back to userId when getUser throws", async () => {
        const mockRequest = {
            headers: { authorization: "Bearer valid-token" },
            user: undefined as any,
        };
        const context = {
            switchToHttp: () => ({
                getRequest: () => mockRequest,
            }),
        };

        privyService.verify.mockResolvedValue({ userId: "user-789" });
        privyService.getUser.mockRejectedValue(new Error("Privy API error"));

        const result = await guard.canActivate(context as any);

        expect(result).toBe(true);
        expect(mockRequest.user.walletAddress).toBe("user-789");
    });

    it("should fall back to userId when wallet account has no address", async () => {
        const mockRequest = {
            headers: { authorization: "Bearer valid-token" },
            user: undefined as any,
        };
        const context = {
            switchToHttp: () => ({
                getRequest: () => mockRequest,
            }),
        };

        privyService.verify.mockResolvedValue({ userId: "user-000" });
        privyService.getUser.mockResolvedValue({
            linkedAccounts: [{ type: "wallet" }],
        });

        const result = await guard.canActivate(context as any);

        expect(result).toBe(true);
        expect(mockRequest.user.walletAddress).toBe("user-000");
    });
});
