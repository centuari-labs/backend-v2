// Mock the Privy import chain before importing AuthGuard.
jest.mock("../../core/privy/privy.service", () => ({}));
jest.mock("../../common/guards/strategies/privy-auth.strategy", () => ({
    PrivyAuthStrategy: class MockPrivyAuthStrategy {
        async validate() {
            return { userId: "mock", walletAddress: "0xMock" };
        }

        async verifyPrincipal() {
            return { userId: "mock" };
        }

        async resolveAuthUser() {
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

describe("AuthController", () => {
    // Throttling is enforced globally by WalletThrottlerGuard (APP_GUARD in
    // app.module.ts), which now keys buckets on the verified identity by
    // itself. A route-level WalletThrottlerGuard would double-count every
    // request against the same user bucket, so the route declares AuthGuard
    // only.
    it("should guard access-code redemption with AuthGuard only", () => {
        const guards = Reflect.getMetadata(
            GUARDS_METADATA,
            AuthController.prototype.redeemAccessCode,
        );

        expect(guards).toEqual([AuthGuard]);
    });
});
