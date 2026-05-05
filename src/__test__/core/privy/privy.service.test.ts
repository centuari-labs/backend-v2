const mockVerifyAuthToken = jest.fn();
const mockGetUser = jest.fn();
const mockImportSPKI = jest.fn();

jest.mock("jose", () => ({
    importSPKI: mockImportSPKI,
}));

jest.mock("@privy-io/server-auth", () => ({
    PrivyClient: jest.fn().mockImplementation(() => ({
        verifyAuthToken: mockVerifyAuthToken,
        getUser: mockGetUser,
    })),
}));

jest.mock("node:fs", () => ({
    existsSync: jest.fn(),
    readFileSync: jest.fn(),
}));

jest.mock("node:path", () => ({
    join: jest.fn().mockReturnValue("/mock/path/key.pub"),
}));

import { UnauthorizedException } from "@nestjs/common";
import { existsSync, readFileSync } from "node:fs";
import { PrivyService } from "../../../core/privy/privy.service";

const mockExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;
const mockReadFileSync = readFileSync as jest.MockedFunction<
    typeof readFileSync
>;

describe("PrivyService", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.env.PRIVY_APP_ID = "test-app-id";
        process.env.PRIVY_PROJECT_SECRET = "test-project-secret";
    });

    describe("constructor / key loading", () => {
        it("should load verification key when file exists", () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue(
                "-----BEGIN PUBLIC KEY-----\nMOCK\n-----END PUBLIC KEY-----",
            );

            const service = new PrivyService();

            expect(mockExistsSync).toHaveBeenCalled();
            expect(mockReadFileSync).toHaveBeenCalled();
        });

        it("should set verificationKey to null when file does not exist", () => {
            mockExistsSync.mockReturnValue(false);

            const service = new PrivyService();

            expect(mockExistsSync).toHaveBeenCalled();
            expect(mockReadFileSync).not.toHaveBeenCalled();
        });
    });

    describe("verify", () => {
        let service: PrivyService;

        beforeEach(() => {
            mockExistsSync.mockReturnValue(false);
            service = new PrivyService();
        });

        it("should return result for valid token with userId", async () => {
            const mockResult = { userId: "did:privy:user-123" };
            mockVerifyAuthToken.mockResolvedValue(mockResult);

            const result = await service.verify("valid-token");

            expect(result).toEqual(mockResult);
            expect(mockVerifyAuthToken).toHaveBeenCalledWith("valid-token");
        });

        it("should throw UnauthorizedException when result is null", async () => {
            mockVerifyAuthToken.mockResolvedValue(null);

            await expect(service.verify("bad-token")).rejects.toThrow(
                UnauthorizedException,
            );
        });

        it("should throw UnauthorizedException when result has no userId", async () => {
            mockVerifyAuthToken.mockResolvedValue({ userId: null });

            await expect(service.verify("bad-token")).rejects.toThrow(
                UnauthorizedException,
            );
        });

        it("should throw UnauthorizedException when verifyAuthToken throws", async () => {
            mockVerifyAuthToken.mockRejectedValue(
                new Error("Verification failed"),
            );

            await expect(service.verify("invalid-token")).rejects.toThrow(
                UnauthorizedException,
            );
        });
    });

    describe("getUser", () => {
        let service: PrivyService;

        beforeEach(() => {
            mockExistsSync.mockReturnValue(false);
            service = new PrivyService();
        });

        it("should return user data on success", async () => {
            const mockUser = {
                id: "did:privy:user-123",
                linkedAccounts: [],
            };
            mockGetUser.mockResolvedValue(mockUser);

            const result = await service.getUser("did:privy:user-123");

            expect(result).toEqual(mockUser);
            expect(mockGetUser).toHaveBeenCalledWith("did:privy:user-123");
        });

        it("should rethrow error on failure", async () => {
            const error = new Error("User not found");
            mockGetUser.mockRejectedValue(error);

            await expect(service.getUser("did:privy:unknown")).rejects.toThrow(
                "User not found",
            );
        });
    });

    describe("getVerificationKey", () => {
        it("should call jose.importSPKI with loaded key", async () => {
            const pemKey =
                "-----BEGIN PUBLIC KEY-----\nMOCK\n-----END PUBLIC KEY-----";
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue(pemKey);
            const mockJwk = { kty: "EC" };
            mockImportSPKI.mockResolvedValue(mockJwk);

            const service = new PrivyService();
            const result = await service.getVerificationKey();

            expect(mockImportSPKI).toHaveBeenCalledWith(pemKey, "ES256");
            expect(result).toEqual(mockJwk);
        });

        it("should throw when verificationKey is null", async () => {
            mockExistsSync.mockReturnValue(false);

            const service = new PrivyService();

            await expect(service.getVerificationKey()).rejects.toThrow(
                "Verification key is not configured",
            );
        });
    });
});
