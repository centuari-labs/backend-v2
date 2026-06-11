import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { AuthStrategyFactory } from "./auth-strategy.factory";
import type { AuthPrincipal, AuthUser } from "./auth-strategy.interface";

interface RequestAuthMemo {
    principal?: Promise<AuthPrincipal | null>;
    authUser?: Promise<AuthUser>;
}

const AUTH_MEMO = Symbol("centuari.requestAuthMemo");

interface MemoCarrier {
    [AUTH_MEMO]?: RequestAuthMemo;
}

export type AuthenticatedRequest = MemoCarrier & {
    headers?: { authorization?: string };
};

/**
 * Single verification path shared by WalletThrottlerGuard (global, pre-route)
 * and AuthGuard (route-level). The PROMISE of each stage — not its value — is
 * memoized on the request object via a Symbol key, so concurrent or repeated
 * consumers share one in-flight verification and a request never verifies a
 * token twice.
 *
 * Two stages (see IAuthStrategy):
 * - getPrincipal: cheap local verification for the throttle bucket key.
 *   NEVER rejects — a failed/missing token only means the tracker falls back
 *   to the IP bucket; rejecting requests is AuthGuard's job.
 * - getAuthUser: full resolution (wallet extraction, may hit network).
 *   Throws UnauthorizedException on failure. When stage-1 settled to null
 *   (which absorbs transient infra errors as well as invalid tokens), this
 *   stage re-attempts a full validate() so a transient blip is not memoized
 *   into a definitive 401 — genuinely invalid tokens still fail.
 */
@Injectable()
export class RequestAuthService {
    // Universal bound for every strategy: nothing larger than this is ever
    // handed to a verifier (crypto or otherwise).
    private static readonly MAX_TOKEN_LENGTH = 4096;

    private readonly logger = new Logger(RequestAuthService.name);

    constructor(private readonly strategyFactory: AuthStrategyFactory) {}

    getPrincipal(request: AuthenticatedRequest): Promise<AuthPrincipal | null> {
        const memo = this.memoOf(request);
        memo.principal ??= this.resolvePrincipal(request);
        return memo.principal;
    }

    getAuthUser(request: AuthenticatedRequest): Promise<AuthUser> {
        const memo = this.memoOf(request);
        memo.authUser ??= this.resolveAuthUser(request);
        return memo.authUser;
    }

    private async resolvePrincipal(
        request: AuthenticatedRequest,
    ): Promise<AuthPrincipal | null> {
        const token = this.extractBearerToken(request);
        if (!token) {
            return null;
        }

        try {
            const strategy = this.strategyFactory.getStrategy(token);
            return await strategy.verifyPrincipal(token);
        } catch (error) {
            // Identity is only a bucket key here — never reject the request.
            this.logger.debug(
                `Principal verification failed: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
            return null;
        }
    }

    private async resolveAuthUser(
        request: AuthenticatedRequest,
    ): Promise<AuthUser> {
        const token = this.extractBearerToken(request);
        if (!token) {
            throw new UnauthorizedException("Authorization header is required");
        }

        const strategy = this.strategyFactory.getStrategy(token);
        const principal = await this.getPrincipal(request);

        const user = principal
            ? await strategy.resolveAuthUser(token, principal)
            : // Stage-1 null conflates "invalid" with "transient infra error";
              // re-attempt the full path so only genuine failures 401.
              await strategy.validate(token);

        if (!user || !user.userId || !user.walletAddress) {
            // A strategy must never resolve to an unusable user; fail closed
            // instead of letting request.user become undefined downstream.
            throw new UnauthorizedException("Invalid or expired token");
        }
        return user;
    }

    private memoOf(request: AuthenticatedRequest): RequestAuthMemo {
        let memo = request[AUTH_MEMO];
        if (!memo) {
            memo = {};
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
        if (token.length > RequestAuthService.MAX_TOKEN_LENGTH) {
            return null;
        }
        return token;
    }
}
