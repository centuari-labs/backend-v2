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

describe("AuthController", () => {
    // Throttling is enforced globally via APP_GUARD (WalletThrottlerGuard
    // registered in app.module.ts), so the route only needs to declare
    // AuthGuard at the route level — declaring WalletThrottlerGuard here
    // too would double-count the same request against the throttle budget.
    it("should guard access-code redemption with AuthGuard only", () => {
        const guards = Reflect.getMetadata(
            GUARDS_METADATA,
            AuthController.prototype.redeemAccessCode,
        );

        expect(guards).toEqual([AuthGuard]);
    });
});
