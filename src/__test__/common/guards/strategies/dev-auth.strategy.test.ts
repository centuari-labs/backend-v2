import { Test, TestingModule } from "@nestjs/testing";
import { UnauthorizedException } from "@nestjs/common";
import { DevAuthStrategy } from "../../../../common/guards/strategies/dev-auth.strategy";

describe("DevAuthStrategy", () => {
    let strategy: DevAuthStrategy;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [DevAuthStrategy],
        }).compile();

        strategy = module.get<DevAuthStrategy>(DevAuthStrategy);
    });

    describe("validate", () => {
        it("should return AuthUser with wallet address from DEV_TOKEN", async () => {
            const walletAddress = "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb";
            const mockToken = `DEV_TOKEN_${walletAddress}`;

            const result = await strategy.validate(mockToken);

            expect(result).toEqual({
                userId: `dev-user-${walletAddress}`,
                walletAddress: walletAddress,
            });
        });

        it("should throw UnauthorizedException for invalid token format", async () => {
            const invalidToken = "INVALID_TOKEN_FORMAT";

            await expect(strategy.validate(invalidToken)).rejects.toThrow(
                UnauthorizedException,
            );
            await expect(strategy.validate(invalidToken)).rejects.toThrow(
                "Invalid dev token format",
            );
        });

        it("should throw UnauthorizedException for empty token after DEV_TOKEN_ prefix", async () => {
            const invalidToken = "DEV_TOKEN_";

            await expect(strategy.validate(invalidToken)).rejects.toThrow(
                UnauthorizedException,
            );
        });

        it("should handle various wallet address formats", async () => {
            const walletAddresses = [
                "0x0000000000000000000000000000000000000000",
                "0xAbCdEf1234567890AbCdEf1234567890AbCdEf12",
                "my-custom-wallet-id",
            ];

            for (const wallet of walletAddresses) {
                const token = `DEV_TOKEN_${wallet}`;
                const result = await strategy.validate(token);

                expect(result.walletAddress).toBe(wallet);
                expect(result.userId).toBe(`dev-user-${wallet}`);
            }
        });
    });

    describe("getName", () => {
        it("should return 'dev'", () => {
            expect(strategy.getName()).toBe("dev");
        });
    });
});
