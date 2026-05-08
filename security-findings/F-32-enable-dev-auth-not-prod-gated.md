# F-32: `ENABLE_DEV_AUTH=true` is not gated by `NODE_ENV` — accidental production toggle = total auth bypass

**Severity**: 🔴 Critical (configuration / deployment)
**OWASP**: A07 Identification & Auth Failures, A05 Security Misconfiguration
**CWE**: CWE-489 (Active Debug Code), CWE-269 (Improper Privilege Management)

## Summary

`AuthStrategyFactory` enables the `DevAuthStrategy` whenever the env var `ENABLE_DEV_AUTH` is exactly the string `"true"`. There is no `NODE_ENV` guard, no production safety check, and no startup error when production deployments somehow ship with the flag set. Because `DevAuthStrategy` accepts any token of the form `DEV_TOKEN_0x<wallet>` and treats the suffix as the authenticated wallet, leaving this flag on in production is a one-line config change away from full impersonation of every user.

The committed `.env` (per F-1) already contains `ENABLE_DEV_AUTH=true`. Anyone who copies that file (e.g. a hurried first deploy) ships production with auth disabled.

## Evidence

`src/common/guards/strategies/auth-strategy.factory.ts:11-22`:

```typescript
constructor(private readonly privyStrategy: PrivyAuthStrategy) {
    if (process.env.ENABLE_DEV_AUTH === "true") {
        this.devStrategy = new DevAuthStrategy();
        this.logger.warn(
            "Dev auth strategy ENABLED — do not use in production",
        );
    } else {
        this.devStrategy = null;
    }
    this.logger.log("Auth strategy: Privy");
}

getStrategy(token?: string): IAuthStrategy {
    if (this.devStrategy && token && DevAuthStrategy.isDevToken(token)) {
        return this.devStrategy;
    }
    return this.privyStrategy;
}
```

Notes:
- The check is `process.env.ENABLE_DEV_AUTH === "true"`. No `NODE_ENV !== "production"` guard.
- The mitigation today is a `logger.warn` line at boot. Operators may miss it among normal startup logs, especially if logs are aggregated by level filters that drop `warn`.

`src/common/guards/strategies/dev-auth.strategy.ts:18-32`:

```typescript
async validate(token: string): Promise<AuthUser> {
    if (!DevAuthStrategy.isDevToken(token)) {
        throw new UnauthorizedException("Invalid dev token format");
    }
    const walletAddress = token.slice(DevAuthStrategy.PREFIX.length);
    if (!walletAddress || !walletAddress.startsWith("0x")) {
        throw new UnauthorizedException(...);
    }
    return {
        userId: `dev-user-${walletAddress.toLowerCase()}`,
        walletAddress,
    };
}
```

A token of the form `DEV_TOKEN_0xVICTIM_WALLET` passes validation, the request gets `req.user.walletAddress = 0xVICTIM_WALLET` and `req.user.userId = dev-user-0xvictim_wallet`. Every downstream service trusts those values.

`.env:13` (currently):

```
ENABLE_DEV_AUTH=true
```

So today's repo, copied into prod as-is, ships with auth disabled.

## Impact

If `ENABLE_DEV_AUTH=true` survives into production:

- **Total user impersonation**: any attacker can log in as any wallet just by knowing its public address. Wallet addresses are public on chain — this is "no auth" in practice.
- **Bypass of every authenticated endpoint**: orders, withdraw, repay, portfolio, deposit. Combined with **F-26** (operator key signs everything), the attacker has the operator sign withdrawal of any user's funds.
- **Bypass of access-code gate** (which is already non-functional — see F-30 — but conceptually).
- **Combined with F-15 (WS no auth)**: WebSocket already accepts no-auth connections, but if the gateway is later wired (F-15 fix) to use the same `AuthStrategyFactory`, the dev-token bypass propagates there too.

The flag isn't merely "test convenience" — it's a kill switch for the entire authentication surface.

### Channels through which the flag could land in production

1. The committed `.env` is copied verbatim by a new operator setting up a deploy.
2. A docker-compose template uses the same env file.
3. CI/CD inherits dev-environment env vars when not explicitly scoped.
4. A staging environment (`NODE_ENV=staging`) is treated as "not prod" by the team but is internet-reachable.
5. An operator toggles it on temporarily for debugging and forgets to unset it.

## Reproduction

```bash
# Local proof — show that ENABLE_DEV_AUTH lets us pose as anyone:
curl -X POST http://localhost:8080/auth/login \
    -H "Authorization: Bearer DEV_TOKEN_0xCEO_WALLET_ADDRESS" \
    -H "Content-Type: application/json"

# Expected (with flag on): 201 with an account record matching that wallet.
# Expected (with flag off): 401.

# In production with the flag on, the same request would impersonate the CEO's wallet for the
# duration of any operation that uses req.user.walletAddress (orders, withdraw, etc.).
```

## Recommended Solution

### 1. Hard-fail at boot if the flag is on in production

`src/common/guards/strategies/auth-strategy.factory.ts`:

```typescript
constructor(private readonly privyStrategy: PrivyAuthStrategy) {
    const devAuthEnabled = process.env.ENABLE_DEV_AUTH === "true";
    const isProduction = process.env.NODE_ENV === "production";

    if (devAuthEnabled && isProduction) {
        // 💣 Refuse to start. Fail closed.
        throw new Error(
            "ENABLE_DEV_AUTH=true is not allowed when NODE_ENV=production. " +
            "Either unset ENABLE_DEV_AUTH or change NODE_ENV.",
        );
    }

    if (devAuthEnabled) {
        this.devStrategy = new DevAuthStrategy();
        this.logger.warn(
            "Dev auth strategy ENABLED — do not use in production. NODE_ENV=" +
                (process.env.NODE_ENV ?? "<unset>"),
        );
    } else {
        this.devStrategy = null;
    }
    this.logger.log(`Auth strategy: Privy (devAuth=${devAuthEnabled ? "on" : "off"})`);
}
```

Throwing in the module constructor causes Nest to abort `bootstrap()` — no HTTP listener ever opens. Far safer than logging a warning.

### 2. Default `NODE_ENV` to `production` if unset

Some platforms ship containers without `NODE_ENV` set, which makes `=== "production"` false even in production. Add a defense at boot:

```typescript
// src/main.ts (very early)
if (!process.env.NODE_ENV) {
    console.error("FATAL: NODE_ENV must be explicitly set");
    process.exit(1);
}
```

Or equivalently fail closed in the factory if `NODE_ENV` is unset *and* dev auth is on.

### 3. Strip `ENABLE_DEV_AUTH` from `.env.example`

When F-1 introduces `.env.example`, that file should NOT include `ENABLE_DEV_AUTH=true`. Operators who copy the example into a new env file shouldn't accidentally enable the bypass. Leave it commented out:

```
# Local development only. NEVER set this in production.
# Setting NODE_ENV=production at the same time will refuse boot.
# ENABLE_DEV_AUTH=true
```

### 4. CI guard against committing the flag

A pre-commit hook / CI check that fails if `.env` is being committed at all (combined with F-1 remediation), and additionally any committed file contains `ENABLE_DEV_AUTH=true`.

```bash
# .husky/pre-commit
if git diff --cached | grep -q '^+.*ENABLE_DEV_AUTH=true'; then
    echo "Refusing to commit ENABLE_DEV_AUTH=true. Comment it out."
    exit 1
fi
```

### 5. Surface the flag at runtime

Add a startup banner that's hard to miss:

```typescript
if (devAuthEnabled) {
    console.error("\n" + "=".repeat(72));
    console.error("  ⚠️  DEV AUTH IS ENABLED — ANY DEV_TOKEN_0x... IMPERSONATES THAT WALLET");
    console.error("=".repeat(72) + "\n");
}
```

Operators who see this scrolling past at deploy time will at least notice.

### 6. Health endpoint exposes the flag (for monitoring)

Make sure `/health` (or whichever endpoint a load balancer hits) returns `{ devAuth: false }` so a misconfigured deploy is alertable from outside the cluster:

```typescript
@Get("health")
async health() {
    return {
        ok: true,
        nodeEnv: process.env.NODE_ENV,
        devAuth: process.env.ENABLE_DEV_AUTH === "true",
    };
}
```

External monitoring can alert on `devAuth: true && nodeEnv === 'production'` without ever seeing user data.

## Verification

```bash
# 1. Boot refusal
NODE_ENV=production ENABLE_DEV_AUTH=true pnpm run start
# Expected: process exits with the explicit error message above.

# 2. Boot allowed in dev
NODE_ENV=development ENABLE_DEV_AUTH=true pnpm run start:dev
# Expected: starts, with the loud banner.

# 3. Boot allowed in production with flag off
NODE_ENV=production ENABLE_DEV_AUTH=false pnpm run start
# Expected: starts, no banner.

# 4. CI test that .env.example does not enable dev auth
grep -E '^ENABLE_DEV_AUTH=true' .env.example && exit 1 || echo "ok"
```

## References

- [OWASP A07:2021 — Identification and Authentication Failures](https://owasp.org/Top10/A07_2021-Identification_and_Authentication_Failures/)
- [CWE-489: Active Debug Code](https://cwe.mitre.org/data/definitions/489.html)
- [12-Factor App: Config](https://12factor.net/config) — env-driven config, fail-closed on misconfig
