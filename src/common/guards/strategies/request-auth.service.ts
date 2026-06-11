import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { AuthStrategyFactory } from "./auth-strategy.factory";
import type { AuthPrincipal, AuthUser } from "./auth-strategy.interface";

interface RequestAuthMemo {
    principal: AuthPrincipal | null;
    principalSettled: boolean;
    authUser?: AuthUser;
    authError?: unknown;
    authSettled: boolean;
}

const AUTH_MEMO = Symbol("centuari.requestAuthMemo");

interface MemoCarrier {
    [AUTH_MEMO]?: RequestAuthMemo;
}

type AuthenticatedRequest = MemoCarrier & {
    headers?: { authorization?: string };
};

/**
 * Single verification path shared by WalletThrottlerGuard (global, pre-route)
 * and AuthGuard (route-level). Results — success AND failure — are memoized
 * on the request object via a Symbol key, so one request never verifies a
 * token twice regardless of how many guards consult it.
 *
 * Two stages (see IAuthStrategy):
 * - getPrincipal: cheap local verification for the throttle bucket key.
 *   NEVER throws — a failed/missing token only means the tracker falls back
 *   to the IP bucket; rejecting requests is AuthGuard's job.
 * - getAuthUser: full resolution (wallet extraction, may hit network).
 *   Throws UnauthorizedException on failure, exactly once per request.
 */
@Injectable()
export class RequestAuthService {
    private readonly logger = new Logger(RequestAuthService.name);

    constructor(private readonly strategyFactory: AuthStrategyFactory) {}

    async getPrincipal(
        request: AuthenticatedRequest,
    ): Promise<AuthPrincipal | null> {
        const memo = this.memoOf(request);
        if (memo.principalSettled) {
            return memo.principal;
        }
        memo.principalSettled = true;

        const token = this.extractBearerToken(request);
        if (!token) {
            return null;
        }

        try {
            const strategy = this.strategyFactory.getStrategy(token);
            memo.principal = await strategy.verifyPrincipal(token);
        } catch (error) {
            // Identity is only a bucket key here — never reject the request.
            this.logger.debug(
                `Principal verification failed: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        }
        return memo.principal;
    }

    async getAuthUser(request: AuthenticatedRequest): Promise<AuthUser> {
        const memo = this.memoOf(request);
        if (memo.authSettled) {
            if (memo.authUser) {
                return memo.authUser;
            }
            throw memo.authError;
        }

        try {
            const token = this.extractBearerToken(request);
            if (!token) {
                throw new UnauthorizedException(
                    "Authorization header is required",
                );
            }

            const principal = await this.getPrincipal(request);
            if (!principal) {
                throw new UnauthorizedException("Invalid or expired token");
            }

            const strategy = this.strategyFactory.getStrategy(token);
            memo.authUser = await strategy.resolveAuthUser(token, principal);
            return memo.authUser;
        } catch (error) {
            memo.authError = error;
            throw error;
        } finally {
            memo.authSettled = true;
        }
    }

    private memoOf(request: AuthenticatedRequest): RequestAuthMemo {
        let memo = request[AUTH_MEMO];
        if (!memo) {
            memo = {
                principal: null,
                principalSettled: false,
                authSettled: false,
            };
            request[AUTH_MEMO] = memo;
        }
        return memo;
    }

    private extractBearerToken(request: AuthenticatedRequest): string | null {
        const authHeader = request.headers?.authorization;
        if (!authHeader) {
            return null;
        }
        const [type, token] = authHeader.split(" ");
        if (type !== "Bearer" || !token) {
            return null;
        }
        return token;
    }
}
