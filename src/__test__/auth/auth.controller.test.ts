// Mock the Privy import chain before importing AuthGuard.
jest.mock("../../core/privy/privy.service", () => ({}));
jest.mock("../../common/guards/strategies/privy-auth.strategy", () => ({
    PrivyAuthStrategy: class MockPrivyAuthStrategy {
        async validate() {
            return { userId: "mock", walletAddress: "0xMock" };
        }

        getName() {
            return "privy";
        }
    },
}));

import { GUARDS_METADATA } from "@nestjs/common/constants";
import { AuthController } from "../../auth/auth.controller";
import { AuthGuard } from "../../common/guards/auth.guard";
import { WalletThrottlerGuard } from "../../common/guards/wallet-throttler.guard";

describe("AuthController", () => {
    it("should throttle access-code redemption after authentication", () => {
        const guards = Reflect.getMetadata(
            GUARDS_METADATA,
            AuthController.prototype.redeemAccessCode,
        );

        expect(guards).toEqual([AuthGuard, WalletThrottlerGuard]);
    });
});
