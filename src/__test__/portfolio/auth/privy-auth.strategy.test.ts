import { Test, TestingModule } from "@nestjs/testing";
import { UnauthorizedException } from "@nestjs/common";
import { PrivyAuthStrategy } from "../../../portfolio/auth/strategies/privy-auth.strategy";

// Mock PrivyService to avoid jose ESM import issues
jest.mock("../../../core/privy/privy.service");

describe("PrivyAuthStrategy", () => {
    let strategy: PrivyAuthStrategy;
    let mockPrivyService: any;

    beforeEach(async () => {
        mockPrivyService = {
            verify: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PrivyAuthStrategy,
                {
                    provide: "PrivyService",
                    useValue: mockPrivyService,
                },
            ],
        }).compile();

        strategy = new PrivyAuthStrategy(mockPrivyService);
    });

    describe("validate", () => {
        it("should return AuthUser with userId and walletAddress from valid Privy token", async () => {
            const mockToken = "valid-privy-token";
            const mockPrivyResult = {
                userId: "did:privy:12345",
                appId: "test-app-id",
                issuer: "privy.io",
                issuedAt: Date.now(),
                expiration: Date.now() + 3600000,
                sessionId: "session-123",
            };

            mockPrivyService.verify.mockResolvedValue(mockPrivyResult);

            const result = await strategy.validate(mockToken);

            expect(result).toEqual({
                userId: "did:privy:12345",
                walletAddress: "did:privy:12345",
            });
            expect(mockPrivyService.verify).toHaveBeenCalledWith(mockToken);
        });

        it("should throw UnauthorizedException when Privy verify returns null", async () => {
            const mockToken = "invalid-token";
            mockPrivyService.verify.mockResolvedValue(null);

            await expect(strategy.validate(mockToken)).rejects.toThrow(
                UnauthorizedException,
            );
            await expect(strategy.validate(mockToken)).rejects.toThrow(
                "Invalid Privy token",
            );
        });

        it("should throw UnauthorizedException when Privy verify returns object without userId", async () => {
            const mockToken = "invalid-token";
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
            const mockToken = "expired-token";
            mockPrivyService.verify.mockRejectedValue(new Error("Token expired"));

            await expect(strategy.validate(mockToken)).rejects.toThrow();
        });
    });

    describe("getName", () => {
        it("should return 'privy'", () => {
            expect(strategy.getName()).toBe("privy");
        });
    });
});

