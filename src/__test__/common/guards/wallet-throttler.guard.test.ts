import { Reflector } from "@nestjs/core";
import type {
    ThrottlerModuleOptions,
    ThrottlerStorage,
} from "@nestjs/throttler";
import { AuthStrategyFactory } from "../../../common/guards/strategies/auth-strategy.factory";
import type { IAuthStrategy } from "../../../common/guards/strategies/auth-strategy.interface";
import { PrivyAuthStrategy } from "../../../common/guards/strategies/privy-auth.strategy";
import { RequestAuthService } from "../../../common/guards/strategies/request-auth.service";
import { WalletThrottlerGuard } from "../../../common/guards/wallet-throttler.guard";

// Mock jose and PrivyService to avoid jose ESM import issues
jest.mock("jose", () => ({}));
jest.mock("../../../core/privy/privy.service");

// getTracker is protected by design; the subclass only widens visibility so
// the placement-sensitive behavior (M-1 lesson: assert guard wiring, not just
// logic) can be exercised directly.
class TestableWalletThrottlerGuard extends WalletThrottlerGuard {
    trackerOf(req: Record<string, unknown>): Promise<string> {
        return this.getTracker(req);
    }
}

const THROTTLER_OPTIONS: ThrottlerModuleOptions = {
    throttlers: [{ name: "short", ttl: 1000, limit: 5 }],
};

const storageStub = {
    increment: jest.fn(),
} as unknown as ThrottlerStorage;

interface MockRequest extends Record<string, unknown> {
    headers: { authorization?: string };
    ip: string;
}

const createRequest = (authHeader?: string, ip = "1.2.3.4"): MockRequest => ({
    headers: { authorization: authHeader },
    ip,
});

describe("WalletThrottlerGuard.getTracker", () => {
    let mockStrategy: jest.Mocked<IAuthStrategy>;
    let guard: TestableWalletThrottlerGuard;

    const buildGuard = (requestAuth: RequestAuthService) =>
        new TestableWalletThrottlerGuard(
            THROTTLER_OPTIONS,
            storageStub,
            new Reflector(),
            requestAuth,
        );

    beforeEach(() => {
        mockStrategy = {
            validate: jest.fn(),
            verifyPrincipal: jest.fn(),
            resolveAuthUser: jest.fn(),
            getName: jest.fn().mockReturnValue("mock"),
        };
        const factory = {
            getStrategy: jest.fn(() => mockStrategy),
        } as unknown as AuthStrategyFactory;
        guard = buildGuard(new RequestAuthService(factory));
    });

    it("keys on the verified user for a valid token — even on a route with no AuthGuard (AE2 placement)", async () => {
        mockStrategy.verifyPrincipal.mockResolvedValue({
            userId: "did:privy:abc",
        });

        // No AuthGuard ran: request.user is untouched. Tracker must still
        // resolve the wallet-bearing identity — this is exactly the case
        // that silently regressed under the old req.user-based tracker.
        const tracker = await guard.trackerOf(
            createRequest("Bearer valid.jwt.token"),
        );

        expect(tracker).toBe("user:did:privy:abc");
    });

    it("gives two different users two different buckets (AE2)", async () => {
        mockStrategy.verifyPrincipal
            .mockResolvedValueOnce({ userId: "did:privy:user-a" })
            .mockResolvedValueOnce({ userId: "did:privy:user-b" });

        const trackerA = await guard.trackerOf(
            createRequest("Bearer token.user.a", "9.9.9.9"),
        );
        const trackerB = await guard.trackerOf(
            createRequest("Bearer token.user.b", "9.9.9.9"),
        );

        expect(trackerA).toBe("user:did:privy:user-a");
        expect(trackerB).toBe("user:did:privy:user-b");
        expect(trackerA).not.toBe(trackerB);
    });

    it("keys the same user identically across different IPs (AE1)", async () => {
        mockStrategy.verifyPrincipal.mockResolvedValue({
            userId: "did:privy:same-user",
        });

        const fromHome = await guard.trackerOf(
            createRequest("Bearer same.jwt.token", "10.0.0.1"),
        );
        const fromOffice = await guard.trackerOf(
            createRequest("Bearer same.jwt.token", "172.16.0.1"),
        );

        expect(fromHome).toBe("user:did:privy:same-user");
        expect(fromOffice).toBe(fromHome);
    });

    it("falls back to the IP bucket when no token is present", async () => {
        const tracker = await guard.trackerOf(
            createRequest(undefined, "5.6.7.8"),
        );

        expect(tracker).toBe("ip:5.6.7.8");
    });

    it("falls back to the IP bucket on an invalid token without throwing (AE3)", async () => {
        mockStrategy.verifyPrincipal.mockRejectedValue(
            new Error("bad signature"),
        );

        const tracker = await guard.trackerOf(
            createRequest("Bearer bad.jwt.token", "5.6.7.8"),
        );

        expect(tracker).toBe("ip:5.6.7.8");
    });

    it("keys dev tokens per dev user through the real factory path", async () => {
        const previousEnv = process.env.ENABLE_DEV_AUTH;
        process.env.ENABLE_DEV_AUTH = "true";
        try {
            const factory = new AuthStrategyFactory(
                new PrivyAuthStrategy(
                    {} as ConstructorParameters<typeof PrivyAuthStrategy>[0],
                ),
            );
            const devGuard = buildGuard(new RequestAuthService(factory));

            const tracker = await devGuard.trackerOf(
                createRequest("Bearer DEV_TOKEN_0xAbC123"),
            );

            expect(tracker).toBe("user:dev-user-0xabc123");
        } finally {
            process.env.ENABLE_DEV_AUTH = previousEnv;
        }
    });

    it("falls back to IP when the resolver itself fails unexpectedly", async () => {
        const brokenResolver = {
            getPrincipal: jest.fn().mockRejectedValue(new Error("boom")),
        } as unknown as RequestAuthService;
        const brokenGuard = buildGuard(brokenResolver);

        const tracker = await brokenGuard.trackerOf(
            createRequest("Bearer any.jwt.token", "7.7.7.7"),
        );

        expect(tracker).toBe("ip:7.7.7.7");
    });
});
