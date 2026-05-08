# F-37: Privy auth path has no defense-in-depth — backend trusts SDK fully

**Severity**: 🟡 Moderate (turns into High under SDK regression / supply-chain attack)
**OWASP**: A07 Identification & Auth Failures, A08 Software and Data Integrity Failures
**CWE**: CWE-345 (Insufficient Verification of Data Authenticity), CWE-1357 (Reliance on Insufficiently Trustworthy Component)

## Summary

`PrivyService.verify` delegates 100% of token validation to `@privy-io/server-auth`'s `verifyAuthToken`. The backend adds no audience check, no expiration override, no clock-skew bound, no replay window, and no rate limit on failed verifications. A regression or supply-chain attack on the SDK (or a misconfiguration where the SDK accepts more than the team thinks) would directly translate into authenticated impersonation across the entire backend.

A second concern: `PrivyService` loads a `verificationKeyPrivy.key.pub` file at construction time but never uses it in `verify()`. The result is a file-system dependency that adds no security value, and a well-named public key that's easy to assume is "doing something" during code review.

## Evidence

### `verify` is a thin wrapper

`src/core/privy/privy.service.ts:51-64`:

```typescript
async verify(token: string) {
    try {
        const result = await this.privy.verifyAuthToken(token);

        if (!result || !result.userId) {
            throw new UnauthorizedException("Invalid Privy Access Token");
        }
        return result;
    } catch (err) {
        console.error("Privy verification error:", err);   // F-22
        throw new UnauthorizedException("Invalid Privy token");
    }
}
```

The backend doesn't:

- **Validate the audience** (`appId`). The SDK is configured with the app id at construction; depending on SDK version it may or may not enforce `aud === appId`. The backend doesn't double-check.
- **Validate the issuer** explicitly — same caveat.
- **Apply a stricter expiration than the token's own `exp`**. Privy's default tokens are long-lived; the backend has no per-route freshness requirement.
- **Reject tokens with future `iat`**. Clock skew between Privy and the backend is masked.
- **Replay-detect**. There's no nonce / jti tracking. A leaked token can be replayed until natural expiry.

### Verification key is loaded but never used

`src/core/privy/privy.service.ts:25-44`:

```typescript
const keyPath = join(__dirname, "..", "..", "..", "keys", "verificationKeyPrivy.key.pub");

if (existsSync(keyPath)) {
    this.verificationKey = readFileSync(keyPath, "utf-8");
    this.logger.log("Verification key loaded successfully");
} else {
    this.verificationKey = null;
    this.logger.warn("Verification key not found at keys/verificationKey.pub.key - getUserInfo will not work");
}

async getVerificationKey() {
    if (!this.verificationKey) {
        throw new Error("Verification key is not configured");
    }
    const key = await jose.importSPKI(this.verificationKey, "ES256");
    return key;
}
```

`getVerificationKey` callers:

```bash
$ grep -rnE "getVerificationKey|verificationKeyPrivy" src --include="*.ts" | grep -v test
src/core/privy/privy.service.ts:29:            "verificationKeyPrivy.key.pub",
src/core/privy/privy.service.ts:43:    async getVerificationKey() {
```

The method exists and is dead. The file load is unnecessary.

### No rate-limit on verification path

`AuthGuard` calls `strategy.validate(token)` for every request. With F-2 (no global throttler) and F-22 (each failure prints `console.error`), an attacker can pummel `verifyAuthToken` with malformed tokens to:

- Burn whatever rate budget Privy's hosted verification endpoint has (if the SDK calls home).
- Drown the stderr stream and deny the team useful logs.
- Probe SDK behavior to find a regression that lets a token pass.

## Impact

### A. SDK regression / supply-chain compromise

If `@privy-io/server-auth` has a bug or is replaced (npm hijack, postinstall script, supplychain), `verifyAuthToken` may return `{ userId: "anything" }` for any input. The backend then trusts that result blindly and assigns the request to that userId. Every authenticated route is impersonated.

This is not theoretical — `event-stream`, `ua-parser-js`, `coa`, `colors.js`, and a long list of npm packages have shipped malicious updates. Single-source verification is the worst case: there's no second opinion to catch it.

### B. Long-lived token replay

If a Privy token leaks (e.g. via XSS in the front end, accidental log, or browser cache), the backend accepts it for the duration of `exp`. With no per-route freshness override, a stolen token is fully usable to withdraw funds (per F-26: operator signs).

### C. Unbounded verification failures

`verifyAuthToken` failing 1000×/sec from a single IP isn't rejected anywhere. In hostile environments this enables:

- Resource exhaustion (CPU, network if the SDK calls Privy's API).
- Credential stuffing of partial tokens (if any small subset of bytes determines the outcome — unlikely for well-designed JWT but cheap to check before SDK sees it).

### D. `verificationKeyPrivy.key.pub` confusion

A reviewer skimming this file might assume the public key is the trust root. It isn't — it's loaded for a never-called method. Moving the trust root to a *different* file or pattern is a real refactor risk if everyone thinks "we already have a public key file."

## Recommended Solution

### 1. Apply defense-in-depth checks alongside the SDK

Even when `verifyAuthToken` succeeds, double-validate fields the backend actually cares about:

```typescript
async verify(token: string) {
    let result;
    try {
        result = await this.privy.verifyAuthToken(token);
    } catch (err) {
        this.logger.warn(`Privy verification failed: ${(err as Error).name}: ${(err as Error).message}`);
        throw new UnauthorizedException("Invalid Privy token");
    }

    if (!result || !result.userId) {
        throw new UnauthorizedException("Invalid Privy Access Token");
    }

    // Belt-and-braces: parse the JWT ourselves and verify the bits that matter.
    const decoded = await jose.jwtVerify(
        token,
        await this.getVerificationKey(),                 // use the previously-dead key file as actual trust root
        {
            issuer: process.env.PRIVY_ISSUER,            // e.g. https://auth.privy.io
            audience: process.env.PRIVY_APP_ID,
            maxTokenAge: "30m",                          // stricter than Privy default
            clockTolerance: "30s",
        },
    );

    if (decoded.payload.sub !== result.userId) {
        // SDK and our own decode disagree — refuse.
        this.logger.error(`Privy SDK / local verify disagree on userId: sdk=${result.userId} local=${decoded.payload.sub}`);
        throw new UnauthorizedException("Token verification mismatch");
    }

    return result;
}
```

The local `jose.jwtVerify` call uses the public key from `keys/verificationKeyPrivy.key.pub` — the file that is currently loaded for nothing. If the key file is the legitimate Privy verification key, this catches an SDK regression. If the team doesn't have the right public key on file, fail boot — better to refuse to start than to fly blind.

### 2. Make `PRIVY_ISSUER` / `PRIVY_APP_ID` mandatory

```typescript
constructor(private readonly configService: ConfigService) {
    const appId = this.configService.get<string>("PRIVY_APP_ID");
    const projectSecret = this.configService.get<string>("PRIVY_PROJECT_SECRET");
    const issuer = this.configService.get<string>("PRIVY_ISSUER");

    if (!appId || !projectSecret || !issuer) {
        throw new Error("PRIVY_APP_ID / PRIVY_PROJECT_SECRET / PRIVY_ISSUER must all be set");
    }
    this.privy = new PrivyClient(appId, projectSecret);
    ...
}
```

Combined with F-1 (env hygiene) and F-32 (NODE_ENV gate), the backend refuses to boot in a partially-configured state.

### 3. Per-route freshness (replay window)

For high-impact routes (withdraw, repay), require a recently issued token. The Privy `iat` claim is enforceable independently of `exp`:

```typescript
if (Date.now() / 1000 - decoded.payload.iat > 5 * 60) {       // 5 min
    throw new UnauthorizedException("Token is too old for this operation; please re-authenticate");
}
```

Apply via a dedicated `FreshAuthGuard` on `/withdraw`, `/portfolio/repay`, `/portfolio/withdraw-lend-position`, `/auth/access-codes/*`.

### 4. Use the verification key directly (and remove the SDK from the hot path) — the assertive option

If the team is comfortable, drop `@privy-io/server-auth` from the verification hot path entirely. `jose` + the public key is sufficient, has fewer dependencies, and is fully under your control:

```typescript
async verify(token: string): Promise<{ userId: string; walletAddress?: string }> {
    const { payload } = await jose.jwtVerify(
        token,
        await this.getVerificationKey(),
        {
            issuer: process.env.PRIVY_ISSUER,
            audience: process.env.PRIVY_APP_ID,
            maxTokenAge: "30m",
            clockTolerance: "30s",
        },
    );
    return {
        userId: payload.sub as string,
        walletAddress: (payload as any).wallet_address as string | undefined,
    };
}
```

Privy SDK is still used for `getUser` (a non-security read), but it's no longer the trust root. This is the model used by most production-grade JWT services (Auth0, Cognito, Okta) — verify the JWT yourself with a JWKS, don't trust the vendor SDK as a black box.

### 5. Rate-limit `AuthGuard` failures

Once F-2 wires the global throttler, add a per-IP failure-bucket to the auth guard so spam-verification can't pin the SDK / the Privy upstream:

```typescript
@Injectable()
export class AuthGuard implements CanActivate {
    private failures = new Map<string, { count: number; resetAt: number }>();

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const req = context.switchToHttp().getRequest();
        const ip = req.ip;
        const now = Date.now();
        const bucket = this.failures.get(ip);
        if (bucket && bucket.resetAt > now && bucket.count >= 20) {
            throw new TooManyRequestsException("Too many failed auth attempts");
        }

        try {
            // ... existing logic
            return true;
        } catch (err) {
            const next = bucket && bucket.resetAt > now
                ? { count: bucket.count + 1, resetAt: bucket.resetAt }
                : { count: 1, resetAt: now + 60_000 };
            this.failures.set(ip, next);
            throw err;
        }
    }
}
```

(Or push the failure-bucket logic into Redis for multi-instance deploys.)

### 6. Remove dead code

If `getVerificationKey()` is not going to be used (option 1 / 2 above re-enable it), delete it and stop loading the file. Don't leave a dead path that looks load-bearing.

```bash
$ git grep -n "getVerificationKey\|verificationKeyPrivy"
# After cleanup: only the new caller (jwtVerify in option 1) should appear, plus the file load.
```

### 7. Subscribe to the Privy SDK security advisories

Operationally, watch `@privy-io/server-auth` releases and dep-audit on every CI run (already done by F-3..F-5 / F-10 remediation). A future SDK CVE is the most likely vector for this finding to become live.

## Verification

```bash
# 1. Backend refuses to boot if Privy env is half-configured
PRIVY_ISSUER= NODE_ENV=production pnpm run start
# Expected: process exits with the explicit error.

# 2. Token with mismatched audience is rejected by the local verifier
node -e "
const jose = require('jose');
// Sign with Privy key but with audience='wrong'
const token = await new jose.SignJWT({...}).setAudience('wrong').sign(privyKey);
// POST /auth/login with token → 401
"

# 3. Stale-token replay blocked on /withdraw
# Take a 31-min-old token, hit /withdraw → 401 'Token is too old'.

# 4. Failure-bucket
for i in $(seq 1 30); do
    curl -X POST http://localhost:8080/me \
        -H "Authorization: Bearer not-a-jwt" -o /dev/null -w "%{http_code}\n"
done
# Expected: first 20 = 401, remaining = 429.
```

## References

- [Privy server-auth SDK docs](https://docs.privy.io/guide/server/access-tokens)
- [jose: jwtVerify](https://github.com/panva/jose/blob/main/docs/functions/jwt_verify.jwtVerify.md)
- [OWASP A08:2021 — Software and Data Integrity Failures](https://owasp.org/Top10/A08_2021-Software_and_Data_Integrity_Failures/)
- [CWE-1357: Reliance on Insufficiently Trustworthy Component](https://cwe.mitre.org/data/definitions/1357.html)
- npm supply-chain incidents: [event-stream (2018)](https://github.com/dominictarr/event-stream/issues/116), [ua-parser-js (2021)](https://github.com/faisalman/ua-parser-js/issues/536)
