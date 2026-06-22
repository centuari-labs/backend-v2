import { UnauthorizedException } from "@nestjs/common";
import { PrivyAuthStrategy } from "../../../../common/guards/strategies/privy-auth.strategy";

// Mock jose and PrivyService to avoid jose ESM import issues
jest.mock("jose", () => ({}));
jest.mock("../../../../core/privy/privy.service");

describe("PrivyAuthStrategy", () => {
    let strategy: PrivyAuthStrategy;
    let mockPrivyService: any;

    beforeEach(() => {
        mockPrivyService = {
            verify: jest.fn(),
            getUser: jest.fn().mockResolvedValue({
                linkedAccounts: [],
            }),
        };

        strategy = new PrivyAuthStrategy(mockPrivyService);
    });

    describe("validate", () => {
        it("should return AuthUser with userId and the linked wallet address", async () => {
            const mockToken = "valid.privy.token";
            const mockPrivyResult = {
                userId: "did:privy:12345",
                appId: "test-app-id",
                issuer: "privy.io",
                issuedAt: Date.now(),
                expiration: Date.now() + 3600000,
                sessionId: "session-123",
            };

            mockPrivyService.verify.mockResolvedValue(mockPrivyResult);
            mockPrivyService.getUser.mockResolvedValue({
                linkedAccounts: [
                    {
                        type: "wallet",
                        walletClientType: "metamask",
                        address: "0xabc0000000000000000000000000000000000001",
                    },
                ],
            });

            const result = await strategy.validate(mockToken);

            expect(result).toEqual({
                userId: "did:privy:12345",
                walletAddress: "0xabc0000000000000000000000000000000000001",
            });
            expect(mockPrivyService.verify).toHaveBeenCalledWith(mockToken);
        });

        it("should fail closed (throw) when the account has no linked wallet", async () => {
            const mockToken = "valid.privy.token";
            mockPrivyService.verify.mockResolvedValue({
                userId: "did:privy:12345",
            });
            mockPrivyService.getUser.mockResolvedValue({ linkedAccounts: [] });

            await expect(strategy.validate(mockToken)).rejects.toThrow(
                UnauthorizedException,
            );
        });

        it("should fail closed (throw) when wallet lookup errors, never returning the DID", async () => {
            const mockToken = "valid.privy.token";
            mockPrivyService.verify.mockResolvedValue({
                userId: "did:privy:12345",
            });
            mockPrivyService.getUser.mockRejectedValue(new Error("upstream"));

            await expect(strategy.validate(mockToken)).rejects.toThrow(
                UnauthorizedException,
            );
        });

        it("should throw UnauthorizedException when Privy verify returns null", async () => {
            const mockToken = "invalid.privy.token";
            mockPrivyService.verify.mockResolvedValue(null);

            await expect(strategy.validate(mockToken)).rejects.toThrow(
                UnauthorizedException,
            );
            await expect(strategy.validate(mockToken)).rejects.toThrow(
                "Invalid Privy token",
            );
        });

        it("should throw UnauthorizedException when Privy verify returns object without userId", async () => {
            const mockToken = "invalid.privy.token";
            mockPrivyService.verify.mockResolvedValue({
                appId: "test-app",
                issuer: "privy.io",
                issuedAt: Date.now(),
                expiration: Date.now() + 3600000,
                sessionId: "session-123",
            });

            await expect(strategy.validate(mockToken)).rejects.toThrow(
                UnauthorizedException,
            );
        });

        it("should throw UnauthorizedException when Privy verify throws error", async () => {
            const mockToken = "expired.privy.token";
            mockPrivyService.verify.mockRejectedValue(
                new Error("Token expired"),
            );

            await expect(strategy.validate(mockToken)).rejects.toThrow();
        });
    });

    describe("verifyPrincipal format pre-check", () => {
        it("rejects non-JWT-shaped tokens before any verification", async () => {
            await expect(strategy.verifyPrincipal("not-a-jwt")).rejects.toThrow(
                UnauthorizedException,
            );
            expect(mockPrivyService.verify).not.toHaveBeenCalled();
        });

        it("rejects oversized tokens before any verification", async () => {
            const huge = `${"a".repeat(5000)}.${"b".repeat(10)}.${"c".repeat(10)}`;

            await expect(strategy.verifyPrincipal(huge)).rejects.toThrow(
                UnauthorizedException,
            );
            expect(mockPrivyService.verify).not.toHaveBeenCalled();
        });

        it("applies the same pre-check to validate() (websocket path)", async () => {
            await expect(strategy.validate("not-a-jwt")).rejects.toThrow(
                UnauthorizedException,
            );
            expect(mockPrivyService.verify).not.toHaveBeenCalled();
        });
    });

    describe("getName", () => {
        it("should return 'privy'", () => {
            expect(strategy.getName()).toBe("privy");
        });
    });
});
