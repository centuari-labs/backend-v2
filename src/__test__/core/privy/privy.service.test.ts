jest.mock("jose", () => ({
    importSPKI: jest.fn(),
    jwtVerify: jest.fn(),
}));

jest.mock("@privy-io/server-auth", () => ({
    PrivyClient: jest.fn().mockImplementation(() => ({
        verifyAuthToken: jest.fn(),
        getUser: jest.fn(),
    })),
}));

jest.mock("node:fs", () => ({
    existsSync: jest.fn().mockReturnValue(false),
    readFileSync: jest.fn(),
}));

import { existsSync, readFileSync } from "node:fs";
import { UnauthorizedException } from "@nestjs/common";
import * as jose from "jose";
import { PrivyService } from "../../../core/privy/privy.service";

const mockImportSPKI = jose.importSPKI as jest.Mock;
const mockJwtVerify = jose.jwtVerify as jest.Mock;
const mockExistsSync = existsSync as jest.Mock;
const mockReadFileSync = readFileSync as jest.Mock;

describe("PrivyService", () => {
    let service: PrivyService;

    beforeEach(() => {
        jest.clearAllMocks();
        mockExistsSync.mockReturnValue(false);
        service = new PrivyService();
    });

    describe("constructor", () => {
        it("should set verificationKey to null when key file does not exist", () => {
            mockExistsSync.mockReturnValue(false);

            const svc = new PrivyService();

            expect((svc as any).verificationKey).toBeNull();
        });

        it("should load verificationKey when key file exists", () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue(
                "-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----",
            );

            const svc = new PrivyService();

            expect((svc as any).verificationKey).toBe(
                "-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----",
            );
        });
    });

    describe("verify", () => {
        it("should return result for valid token", async () => {
            const mockResult = { userId: "user-123" };
            (service as any).privy.verifyAuthToken = jest
                .fn()
                .mockResolvedValue(mockResult);

            const result = await service.verify("valid-token");

            expect(result).toEqual(mockResult);
        });

        it("should throw UnauthorizedException when result is null", async () => {
            (service as any).privy.verifyAuthToken = jest
                .fn()
                .mockResolvedValue(null);

            await expect(service.verify("bad-token")).rejects.toThrow(
                UnauthorizedException,
            );
        });

        it("should throw UnauthorizedException when userId is missing", async () => {
            (service as any).privy.verifyAuthToken = jest
                .fn()
                .mockResolvedValue({});

            await expect(service.verify("bad-token")).rejects.toThrow(
                UnauthorizedException,
            );
        });

        it("should throw UnauthorizedException when verifyAuthToken throws", async () => {
            (service as any).privy.verifyAuthToken = jest
                .fn()
                .mockRejectedValue(new Error("Token expired"));

            await expect(service.verify("expired-token")).rejects.toThrow(
                UnauthorizedException,
            );
        });

        it('should throw with "Invalid Privy token" message on error', async () => {
            (service as any).privy.verifyAuthToken = jest
                .fn()
                .mockRejectedValue(new Error("Network error"));

            await expect(service.verify("bad")).rejects.toThrow(
                "Invalid Privy token",
            );
        });
    });

    describe("getVerificationKey", () => {
        it("should throw when verificationKey is null", async () => {
            (service as any).verificationKey = null;

            await expect(service.getVerificationKey()).rejects.toThrow(
                "Verification key is not configured",
            );
        });

        it("should import SPKI key when verificationKey exists", async () => {
            const mockKey = { type: "public" };
            (service as any).verificationKey = "PEM-KEY";
            mockImportSPKI.mockResolvedValue(mockKey);

            const result = await service.getVerificationKey();

            expect(result).toBe(mockKey);
            expect(mockImportSPKI).toHaveBeenCalledWith("PEM-KEY", "ES256");
        });
    });

    describe("getUserInfo", () => {
        it("should verify JWT with correct parameters", async () => {
            const mockKey = { type: "public" };
            (service as any).verificationKey = "PEM-KEY";
            mockImportSPKI.mockResolvedValue(mockKey);
            mockJwtVerify.mockResolvedValue({ payload: { sub: "user-1" } });

            await service.getUserInfo(
                "access-token",
                "issuer.com",
                "audience-1",
            );

            expect(mockJwtVerify).toHaveBeenCalledWith(
                "access-token",
                mockKey,
                {
                    issuer: "issuer.com",
                    audience: "audience-1",
                },
            );
        });

        it("should throw when verification key is not configured", async () => {
            (service as any).verificationKey = null;

            await expect(
                service.getUserInfo("token", "issuer", "audience"),
            ).rejects.toThrow("Failed to fetch user info");
        });

        it("should throw when jwtVerify fails", async () => {
            (service as any).verificationKey = "PEM-KEY";
            mockImportSPKI.mockResolvedValue({});
            mockJwtVerify.mockRejectedValue(new Error("JWT expired"));

            await expect(
                service.getUserInfo("token", "issuer", "audience"),
            ).rejects.toThrow("Failed to fetch user info");
        });
    });

    describe("getUser", () => {
        it("should return user from privy client", async () => {
            const mockUser = { id: "user-1", linkedAccounts: [] };
            (service as any).privy.getUser = jest
                .fn()
                .mockResolvedValue(mockUser);

            const result = await service.getUser("user-1");

            expect(result).toEqual(mockUser);
        });

        it("should propagate errors from privy client", async () => {
            (service as any).privy.getUser = jest
                .fn()
                .mockRejectedValue(new Error("User not found"));

            await expect(service.getUser("bad-user")).rejects.toThrow(
                "User not found",
            );
        });
    });
});
