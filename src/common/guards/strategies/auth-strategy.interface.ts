export interface AuthUser {
    userId: string;
    walletAddress: string;
}

/**
 * Identity proven by cheap, local-only verification (stage 1). Used as the
 * throttler bucket key; carries no wallet because resolving the wallet is a
 * network call (stage 2).
 */
export interface AuthPrincipal {
    userId: string;
}

export interface IAuthStrategy {
    validate(token: string): Promise<AuthUser>;
    /**
     * Stage 1 — cheap verification only. Runs on every request via the
     * throttler tracker, so it must not add network calls beyond what token
     * verification itself requires.
     */
    verifyPrincipal(token: string): Promise<AuthPrincipal>;
    /**
     * Stage 2 — full resolution for an already-verified principal. May hit
     * the network (e.g., Privy getUser for wallet extraction).
     */
    resolveAuthUser(token: string, principal: AuthPrincipal): Promise<AuthUser>;
    getName(): string;
}
