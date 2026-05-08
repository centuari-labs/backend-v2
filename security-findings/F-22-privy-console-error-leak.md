# F-22: `PrivyService.verify` uses raw `console.error` — token-shaped data leaks to stderr

**Severity**: 🟡 Moderate
**OWASP**: A09 Security Logging and Monitoring Failures, A05 Security Misconfiguration
**CWE**: CWE-532 (Insertion of Sensitive Information into Log File), CWE-209 (Information Exposure Through an Error Message)

## Summary

`PrivyService.verify` catches verification errors with `console.error("Privy verification error:", err)` instead of routing through the NestJS `Logger`. This:

1. Bypasses the project's logger filtering, log levels, and structured-log redaction.
2. Dumps the raw `err` object (including stack traces and SDK-internal state) directly to stderr. Depending on the Privy SDK's error shape, this can include the offending JWT payload (and in some SDK versions, the raw token string) in plaintext logs.

In an environment where logs are aggregated to a third party or stored without scrubbing, leaked Privy tokens give an attacker temporary impersonation power until those tokens expire.

## Evidence

`src/core/privy/privy.service.ts:51-63`:

```typescript
async verify(token: string) {
    try {
        const result = await this.privy.verifyAuthToken(token);
        if (!result || !result.userId) {
            throw new UnauthorizedException("Invalid Privy Access Token");
        }
        return result;
    } catch (err) {
        console.error("Privy verification error:", err);   // ⚠️ raw stderr
        throw new UnauthorizedException("Invalid Privy token");
    }
}
```

The same file uses `this.logger` elsewhere (e.g. `this.logger.warn("Verification key not found...")`), so the inconsistency is purely a missed cleanup.

Privy SDK errors include fields like `err.cause`, `err.response`, and (in some versions) `err.token` for context. None of these are redacted here.

## Impact

- **F-22.1 — Token leak via logs**: an attacker who triggers verification failures (e.g. tampered tokens) puts their tokens — or, more dangerously, the tokens of legitimate users whose tokens partially decoded then failed signature check — into stderr. If stderr is captured by Datadog / CloudWatch / Loki, those tokens persist.
- **F-22.2 — Stack trace leak**: full Privy SDK and viem-style stack traces in stderr help attackers fingerprint the runtime (overlap with F-14).
- **F-22.3 — Inconsistent telemetry**: `console.error` doesn't carry the Nest `Logger` request context, so SREs can't correlate the error with a request ID.

## Recommended Solution

### 1. Replace `console.error` with the existing `Logger`

`src/core/privy/privy.service.ts`:

```diff
  async verify(token: string) {
      try {
          const result = await this.privy.verifyAuthToken(token);
          if (!result || !result.userId) {
              throw new UnauthorizedException("Invalid Privy Access Token");
          }
          return result;
      } catch (err) {
-         console.error("Privy verification error:", err);
+         // Log the error class and message only — never the token, never the full stack.
+         this.logger.warn(
+             `Privy verification failed: ${(err as Error)?.name ?? "Error"} — ${(err as Error)?.message ?? "unknown"}`,
+         );
          throw new UnauthorizedException("Invalid Privy token");
      }
  }
```

### 2. Lint rule against `console` in production code

Add a Biome lint rule (or eslint `no-console`):

```json
// biome.json
{
    "linter": {
        "rules": {
            "suspicious": {
                "noConsole": {
                    "level": "error",
                    "options": { "allow": ["assert"] }
                }
            }
        }
    }
}
```

Then audit and fix the remaining occurrences:

```bash
$ grep -rn "console\.\(log\|error\|warn\)" src --include="*.ts" | grep -v "scripts/\|test\|spec"
```

(Migration scripts under `src/core/database/scripts/` are CLI tools and can keep `console.log` if explicitly excluded.)

### 3. Mask the token even on success-path logs

If you need to log a token reference for debugging, log only a hash:

```typescript
private hashToken(token: string): string {
    return require("node:crypto")
        .createHash("sha256")
        .update(token)
        .digest("hex")
        .slice(0, 12);
}

this.logger.debug(`verify ok userId=${result.userId} tokenRef=${this.hashToken(token)}`);
```

The hash is enough to correlate sessions across logs without exposing the token.

### 4. Audit other places that log auth material

```bash
$ grep -rnE "logger\.(log|warn|error|debug).*\b(token|secret|password|private_key)\b" src --include="*.ts"
```

Mask anything that comes back. Where wallet addresses are logged (e.g. `auth.service.ts:51`), prefer a short form:

```typescript
private maskWallet(addr: string): string {
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
```

## Verification

```bash
# Trigger a Privy failure and check what reaches stdout
curl -X POST http://localhost:8080/auth/login \
    -H "Authorization: Bearer this-is-not-a-jwt"

docker logs <backend-container> 2>&1 | tail -20
# Expected: a single WARN line with class+message, no token, no stack trace.
```

## References

- [OWASP A09:2021 — Security Logging and Monitoring Failures](https://owasp.org/Top10/A09_2021-Security_Logging_and_Monitoring_Failures/)
- [CWE-532: Insertion of Sensitive Information into Log File](https://cwe.mitre.org/data/definitions/532.html)
- [Biome `noConsole` rule](https://biomejs.dev/linter/rules/no-console/)
