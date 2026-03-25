jest.mock("@privy-io/server-auth", () => ({
    PrivyClient: jest.fn().mockImplementation(() => ({
        verifyAuthToken: jest.fn(),
        getUser: jest.fn(),
    })),
}));

jest.mock("jose", () => ({
    importSPKI: jest.fn(),
    jwtVerify: jest.fn(),
}));

jest.mock("node:fs", () => ({
    existsSync: jest.fn().mockReturnValue(false),
    readFileSync: jest.fn(),
}));

import { existsSync, readFileSync } from "node:fs";
import { UnauthorizedException } from "@nestjs/common";
import * as jose from "jose";
import { PrivyService } from "../../../core/privy/privy.service";

describe("PrivyService", () => {
    let service: PrivyService;
    let mockPrivyClient: any;

    beforeEach(() => {
        (existsSync as jest.Mock).mockReturnValue(false);
        service = new PrivyService();
        mockPrivyClient = (service as any).privy;
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("constructor", () => {
        it("should set verificationKey to null when key file does not exist", () => {
            expect((service as any).verificationKey).toBeNull();
        });

        it("should load verification key when key file exists", () => {
            (existsSync as jest.Mock).mockReturnValue(true);
            (readFileSync as jest.Mock).mockReturnValue("PEM-KEY-CONTENT");

            const svc = new PrivyService();

            expect((svc as any).verificationKey).toBe("PEM-KEY-CONTENT");
        });
    });

    describe("verify", () => {
        it("should return result for valid token", async () => {
            const mockResult = {
                userId: "did:privy:user123",
                issuer: "privy.io",
                appId: "app-123",
            };
            mockPrivyClient.verifyAuthToken.mockResolvedValue(mockResult);

            const result = await service.verify("valid-token");

            expect(result).toEqual(mockResult);
            expect(mockPrivyClient.verifyAuthToken).toHaveBeenCalledWith(
                "valid-token",
            );
        });

        it("should throw UnauthorizedException when result is null", async () => {
            mockPrivyClient.verifyAuthToken.mockResolvedValue(null);

            await expect(service.verify("token")).rejects.toThrow(
                UnauthorizedException,
            );
        });

        it("should throw UnauthorizedException when result has no userId", async () => {
            mockPrivyClient.verifyAuthToken.mockResolvedValue({});

            await expect(service.verify("token")).rejects.toThrow(
                UnauthorizedException,
            );
        });

        it("should throw UnauthorizedException when verifyAuthToken throws", async () => {
            mockPrivyClient.verifyAuthToken.mockRejectedValue(
                new Error("Invalid"),
            );

            await expect(service.verify("bad-token")).rejects.toThrow(
                UnauthorizedException,
            );
            await expect(service.verify("bad-token")).rejects.toThrow(
                "Invalid Privy token",
            );
        });
    });

    describe("getVerificationKey", () => {
        it("should throw when verification key is not configured", async () => {
            await expect(service.getVerificationKey()).rejects.toThrow(
                "Verification key is not configured",
            );
        });

        it("should import and return SPKI key when configured", async () => {
            (service as any).verificationKey = "PEM-KEY";
            const mockKey = { type: "public" };
            (jose.importSPKI as jest.Mock).mockResolvedValue(mockKey);

            const result = await service.getVerificationKey();

            expect(result).toBe(mockKey);
            expect(jose.importSPKI).toHaveBeenCalledWith("PEM-KEY", "ES256");
        });
    });

    describe("getUserInfo", () => {
        it("should throw when verification key is not configured", async () => {
            await expect(
                service.getUserInfo("token", "issuer", "audience"),
            ).rejects.toThrow("Failed to fetch user info");
        });

        it("should verify JWT when key is configured", async () => {
            (service as any).verificationKey = "PEM-KEY";
            const mockKey = { type: "public" };
            (jose.importSPKI as jest.Mock).mockResolvedValue(mockKey);
            (jose.jwtVerify as jest.Mock).mockResolvedValue({
                payload: { sub: "user" },
            });

            await service.getUserInfo("token", "issuer", "audience");

            expect(jose.jwtVerify).toHaveBeenCalledWith("token", mockKey, {
                issuer: "issuer",
                audience: "audience",
            });
        });

        it("should throw when jwtVerify fails", async () => {
            (service as any).verificationKey = "PEM-KEY";
            (jose.importSPKI as jest.Mock).mockResolvedValue({
                type: "public",
            });
            (jose.jwtVerify as jest.Mock).mockRejectedValue(
                new Error("JWT expired"),
            );

            await expect(
                service.getUserInfo("token", "issuer", "audience"),
            ).rejects.toThrow("Failed to fetch user info");
        });
    });

    describe("getUser", () => {
        it("should return user from privy client", async () => {
            const mockUser = { id: "user123", linkedAccounts: [] };
            mockPrivyClient.getUser.mockResolvedValue(mockUser);

            const result = await service.getUser("user123");

            expect(result).toEqual(mockUser);
            expect(mockPrivyClient.getUser).toHaveBeenCalledWith("user123");
        });

        it("should rethrow errors from privy client", async () => {
            mockPrivyClient.getUser.mockRejectedValue(
                new Error("User not found"),
            );

            await expect(service.getUser("nonexistent")).rejects.toThrow(
                "User not found",
            );
        });
    });
});
