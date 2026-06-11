import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
    ThrottlerException,
    type ThrottlerModuleOptions,
    ThrottlerStorageService,
} from "@nestjs/throttler";
import type { RequestAuthService } from "../../common/guards/strategies/request-auth.service";
import { WalletThrottlerGuard } from "../../common/guards/wallet-throttler.guard";
import { PortfolioController } from "../../portfolio/portfolio.controller";

// Mock jose and PrivyService to avoid jose ESM import issues
jest.mock("jose", () => ({}));
jest.mock("../../core/privy/privy.service");

// Same shape the app registers in app.module.ts.
const THROTTLER_OPTIONS: ThrottlerModuleOptions = [
    { name: "short", ttl: 1000, limit: 5 },
    { name: "long", ttl: 60000, limit: 60 },
];

const ON_CHAIN_HANDLERS = ["repay", "withdrawLendPosition"] as const;

describe("PortfolioController throttling", () => {
    describe("@Throttle metadata (reflection)", () => {
        it.each(ON_CHAIN_HANDLERS)(
            "%s carries the tight on-chain budget (1/1s + 5/60s)",
            (handlerName) => {
                const handler = PortfolioController.prototype[handlerName];

                expect(Reflect.getMetadata("THROTTLER:TTLshort", handler)).toBe(
                    1000,
                );
                expect(
                    Reflect.getMetadata("THROTTLER:LIMITshort", handler),
                ).toBe(1);
                expect(Reflect.getMetadata("THROTTLER:TTLlong", handler)).toBe(
                    60000,
                );
                expect(
                    Reflect.getMetadata("THROTTLER:LIMITlong", handler),
                ).toBe(5);
            },
        );
    });

    describe("runtime 429 through the real guard + real Reflector", () => {
        let storage: ThrottlerStorageService;
        let guard: WalletThrottlerGuard;

        // Token → principal map: the tracker resolves whatever the "Privy"
        // verification would have produced for that bearer token.
        const principals = new Map<string, string>([
            ["token-user-a", "did:privy:user-a"],
            ["token-user-b", "did:privy:user-b"],
        ]);

        const requestAuthStub = {
            getPrincipal: jest.fn(
                async (req: { headers?: { authorization?: string } }) => {
                    const token = req.headers?.authorization?.replace(
                        "Bearer ",
                        "",
                    );
                    const userId = token ? principals.get(token) : undefined;
                    return userId ? { userId } : null;
                },
            ),
        } as unknown as RequestAuthService;

        const createContext = (token: string, ip: string): ExecutionContext => {
            const request = {
                headers: { authorization: `Bearer ${token}` },
                ip,
            };
            const response = { header: jest.fn() };
            return {
                switchToHttp: () => ({
                    getRequest: () => request,
                    getResponse: () => response,
                }),
                getHandler: () => PortfolioController.prototype.repay,
                getClass: () => PortfolioController,
            } as unknown as ExecutionContext;
        };

        beforeEach(async () => {
            storage = new ThrottlerStorageService();
            guard = new WalletThrottlerGuard(
                THROTTLER_OPTIONS,
                storage,
                new Reflector(),
                requestAuthStub,
            );
            await guard.onModuleInit();
        });

        afterEach(() => {
            storage.onApplicationShutdown();
        });

        it("Covers AE1: second repay within 1s from the same user throws 429 even from a different IP", async () => {
            await expect(
                guard.canActivate(createContext("token-user-a", "10.0.0.1")),
            ).resolves.toBe(true);

            await expect(
                guard.canActivate(createContext("token-user-a", "172.16.0.9")),
            ).rejects.toThrow(ThrottlerException);
        });

        it("Covers AE2: two different users behind the same IP both pass within the same second", async () => {
            await expect(
                guard.canActivate(createContext("token-user-a", "10.0.0.1")),
            ).resolves.toBe(true);

            await expect(
                guard.canActivate(createContext("token-user-b", "10.0.0.1")),
            ).resolves.toBe(true);
        });
    });
});
