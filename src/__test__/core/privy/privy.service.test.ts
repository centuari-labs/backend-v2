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

    describe("constructor / env validation", () => {
        beforeEach(() => {
            mockExistsSync.mockReturnValue(false);
        });

        it("should throw when PRIVY_APP_ID is missing", () => {
            process.env.PRIVY_APP_ID = "";

            expect(() => new PrivyService()).toThrow(/PRIVY_APP_ID/);
        });

        it("should throw when PRIVY_PROJECT_SECRET is missing", () => {
            process.env.PRIVY_PROJECT_SECRET = "";

            expect(() => new PrivyService()).toThrow(/PRIVY_PROJECT_SECRET/);
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

    describe("verify with local key (stale-key self-heal)", () => {
        const pemKey =
            "-----BEGIN PUBLIC KEY-----\nMOCK\n-----END PUBLIC KEY-----";
        let service: PrivyService;

        beforeEach(() => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue(pemKey);
            service = new PrivyService();
        });

        it("verifies locally using the key file (no network key fetch)", async () => {
            mockVerifyAuthToken.mockResolvedValue({ userId: "did:privy:u1" });

            const result = await service.verify("tok.en.a");

            expect(result).toEqual({ userId: "did:privy:u1" });
            expect(mockVerifyAuthToken).toHaveBeenCalledWith(
                "tok.en.a",
                pemKey,
            );
        });

        it("self-heals when the local key is stale: falls back to the fetched key and stops trusting the file", async () => {
            mockVerifyAuthToken.mockImplementation((_token, key) =>
                key
                    ? Promise.reject(new Error("bad signature"))
                    : Promise.resolve({ userId: "did:privy:u1" }),
            );

            const result = await service.verify("tok.en.a");
            expect(result).toEqual({ userId: "did:privy:u1" });
            expect(mockVerifyAuthToken).toHaveBeenNthCalledWith(
                1,
                "tok.en.a",
                pemKey,
            );
            expect(mockVerifyAuthToken).toHaveBeenNthCalledWith(2, "tok.en.a");

            // Stale flag flipped: subsequent verifies skip the local key.
            mockVerifyAuthToken.mockClear();
            await service.verify("tok.en.b");
            expect(mockVerifyAuthToken).toHaveBeenCalledTimes(1);
            expect(mockVerifyAuthToken).toHaveBeenCalledWith("tok.en.b");
        });

        it("throws Unauthorized when both local and fetched-key verification fail", async () => {
            mockVerifyAuthToken.mockRejectedValue(new Error("bad signature"));

            await expect(service.verify("tok.en.a")).rejects.toThrow(
                UnauthorizedException,
            );
        });
    });

    describe("onModuleInit prewarm", () => {
        it("fires a non-blocking best-effort prewarm when no key file exists", async () => {
            mockExistsSync.mockReturnValue(false);
            mockVerifyAuthToken.mockRejectedValue(new Error("expected"));

            const service = new PrivyService();
            expect(() => service.onModuleInit()).not.toThrow();

            // Flush the swallowed rejection.
            await new Promise(process.nextTick);
            expect(mockVerifyAuthToken).toHaveBeenCalledTimes(1);
        });

        it("skips the prewarm entirely when the local key file is present", () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue("PEM");

            const service = new PrivyService();
            service.onModuleInit();

            expect(mockVerifyAuthToken).not.toHaveBeenCalled();
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
