jest.mock("@privy-io/server-auth", () => ({
    PrivyClient: jest.fn(),
}));

jest.mock("jose", () => ({}));

import { UnauthorizedException } from "@nestjs/common";
import { PrivyGuard } from "../../../core/privy/privy.guard";

describe("PrivyGuard", () => {
    let guard: PrivyGuard;
    let mockPrivyService: {
        verify: jest.Mock;
        getUserInfo: jest.Mock;
    };

    const createMockContext = (headers: Record<string, string> = {}) => {
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
            getUserInfo: jest.fn(),
        };
        guard = new PrivyGuard(mockPrivyService as any);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("canActivate", () => {
        it("should throw UnauthorizedException when no authorization header", async () => {
            const context = createMockContext({});

            await expect(guard.canActivate(context as any)).rejects.toThrow(
                UnauthorizedException,
            );
            await expect(guard.canActivate(context as any)).rejects.toThrow(
                "Missing Authorization header",
            );
        });

        it("should throw UnauthorizedException when token is empty", async () => {
            const context = createMockContext({ authorization: "Bearer " });

            // The code does auth.replace("Bearer ", "").trim() which gives ""
            await expect(guard.canActivate(context as any)).rejects.toThrow(
                UnauthorizedException,
            );
            await expect(guard.canActivate(context as any)).rejects.toThrow(
                "Missing token",
            );
        });

        it("should call verify and getUserInfo and set req.user on success", async () => {
            const context = createMockContext({
                authorization: "Bearer valid-token",
            });
            const mockUser = {
                userId: "did:privy:user1",
                issuer: "privy.io",
                appId: "app-1",
            };

            mockPrivyService.verify.mockResolvedValue(mockUser);
            mockPrivyService.getUserInfo.mockResolvedValue({ sub: "user1" });

            const result = await guard.canActivate(context as any);

            expect(result).toBe(true);
            expect(mockPrivyService.verify).toHaveBeenCalledWith("valid-token");
            expect(mockPrivyService.getUserInfo).toHaveBeenCalledWith(
                "valid-token",
                "privy.io",
                "app-1",
            );
            expect(context._request.user).toEqual(mockUser);
        });

        it("should propagate verify errors", async () => {
            const context = createMockContext({
                authorization: "Bearer bad-token",
            });
            mockPrivyService.verify.mockRejectedValue(
                new UnauthorizedException("Invalid Privy token"),
            );

            await expect(guard.canActivate(context as any)).rejects.toThrow(
                UnauthorizedException,
            );
        });

        it("should propagate getUserInfo errors", async () => {
            const context = createMockContext({
                authorization: "Bearer valid-token",
            });
            mockPrivyService.verify.mockResolvedValue({
                userId: "user1",
                issuer: "privy.io",
                appId: "app-1",
            });
            mockPrivyService.getUserInfo.mockRejectedValue(
                new Error("Key not configured"),
            );

            await expect(guard.canActivate(context as any)).rejects.toThrow(
                "Key not configured",
            );
        });
    });
});
