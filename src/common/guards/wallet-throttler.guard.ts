import { Injectable, Logger } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
    InjectThrottlerOptions,
    InjectThrottlerStorage,
    ThrottlerGuard,
    type ThrottlerModuleOptions,
    type ThrottlerStorage,
} from "@nestjs/throttler";
import {
    type AuthenticatedRequest,
    RequestAuthService,
} from "./strategies/request-auth.service";

/**
 * Global throttler (APP_GUARD) whose bucket key is the VERIFIED identity.
 *
 * Global guards run before route-level guards, so `request.user` is never
 * populated here — the guard verifies the bearer token itself via the shared
 * RequestAuthService (stage-1, local JWT verification only; memoized so
 * AuthGuard never re-verifies). Requests without a verifiable token fall
 * back to the per-IP bucket. The `user:` / `ip:` prefixes keep the two key
 * namespaces separate and make bucket types readable when debugging storage.
 */
@Injectable()
export class WalletThrottlerGuard extends ThrottlerGuard {
    private readonly trackerLogger = new Logger(WalletThrottlerGuard.name);

    constructor(
        @InjectThrottlerOptions() options: ThrottlerModuleOptions,
        @InjectThrottlerStorage() storageService: ThrottlerStorage,
        reflector: Reflector,
        private readonly requestAuth: RequestAuthService,
    ) {
        super(options, storageService, reflector);
    }

    protected async getTracker(req: Record<string, unknown>): Promise<string> {
        try {
            const principal = await this.requestAuth.getPrincipal(
                req as AuthenticatedRequest,
            );
            if (principal) {
                return `user:${principal.userId}`;
            }
        } catch (error) {
            // Tracker resolution must never reject a request — fall through
            // to the IP bucket. (RequestAuthService already absorbs strategy
            // errors; this is a defensive net for unexpected failures.)
            this.trackerLogger.warn(
                `Tracker resolution failed, falling back to IP: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        }
        return `ip:${String(req.ip)}`;
    }
}
