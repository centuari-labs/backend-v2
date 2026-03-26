jest.mock("../../../core/privy/privy.service", () => ({}));

import { UnauthorizedException } from "@nestjs/common";
import { PrivyGuard } from "../../../core/privy/privy.guard";
import { createMockPrivyService } from "../../helpers/mock-services";

describe("PrivyGuard", () => {
    let guard: PrivyGuard;
    let privyService: ReturnType<typeof createMockPrivyService>;

    beforeEach(() => {
        privyService = createMockPrivyService();
        guard = new PrivyGuard(privyService as any);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it("should throw UnauthorizedException when no authorization header", async () => {
        const context = {
            switchToHttp: () => ({
                getRequest: () => ({ headers: {} }),
            }),
        };

        await expect(guard.canActivate(context as any)).rejects.toThrow(
            UnauthorizedException,
        );
    });

    it("should throw UnauthorizedException with correct message", async () => {
        const context = {
            switchToHttp: () => ({
                getRequest: () => ({ headers: {} }),
            }),
        };

        await expect(guard.canActivate(context as any)).rejects.toThrow(
            "Missing Authorization header",
        );
    });

    it("should throw UnauthorizedException when token is empty", async () => {
        const context = {
            switchToHttp: () => ({
                getRequest: () => ({ headers: { authorization: "Bearer " } }),
            }),
        };

        await expect(guard.canActivate(context as any)).rejects.toThrow(
            UnauthorizedException,
        );
    });

    it("should return true and attach user when token is valid", async () => {
        const mockRequest = {
            headers: { authorization: "Bearer valid-token" },
            user: undefined as any,
        };
        const context = {
            switchToHttp: () => ({
                getRequest: () => mockRequest,
            }),
        };

        const mockUser = {
            userId: "user-1",
            issuer: "privy.io",
            appId: "app-1",
        };
        privyService.verify.mockResolvedValue(mockUser);
        privyService.getUserInfo.mockResolvedValue({ sub: "user-1" });

        const result = await guard.canActivate(context as any);

        expect(result).toBe(true);
        expect(mockRequest.user).toBe(mockUser);
        expect(privyService.verify).toHaveBeenCalledWith("valid-token");
        expect(privyService.getUserInfo).toHaveBeenCalledWith(
            "valid-token",
            "privy.io",
            "app-1",
        );
    });

    it("should strip Bearer prefix correctly", async () => {
        const mockRequest = {
            headers: { authorization: "Bearer eyJhbGciOi" },
            user: undefined as any,
        };
        const context = {
            switchToHttp: () => ({
                getRequest: () => mockRequest,
            }),
        };

        const mockUser = { userId: "u", issuer: "i", appId: "a" };
        privyService.verify.mockResolvedValue(mockUser);
        privyService.getUserInfo.mockResolvedValue({});

        await guard.canActivate(context as any);

        expect(privyService.verify).toHaveBeenCalledWith("eyJhbGciOi");
    });

    it("should propagate verify errors", async () => {
        const context = {
            switchToHttp: () => ({
                getRequest: () => ({
                    headers: { authorization: "Bearer bad" },
                }),
            }),
        };

        privyService.verify.mockRejectedValue(
            new UnauthorizedException("Invalid"),
        );

        await expect(guard.canActivate(context as any)).rejects.toThrow(
            UnauthorizedException,
        );
    });
});
