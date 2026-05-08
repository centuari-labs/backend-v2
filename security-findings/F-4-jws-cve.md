# F-4: jws 3.2.2 — improperly verifies HMAC signature

**Severity**: 🟠 High (depends on usage)
**OWASP**: A02 Cryptographic Failures, A06 Vulnerable Components
**CVE/GHSA**: GHSA-869p-cjfg-cm3x

## Summary

`jws@3.2.2` (transitive via `passport-jwt`) does not correctly verify the HMAC signature in some edge cases. If the code path actually uses passport-jwt to verify user-supplied tokens, **JWT forgery becomes possible**.

## Evidence

```
Path: .>passport-jwt>jsonwebtoken>jws
Vulnerable: 3.2.2
Patched: >=3.2.3 (or jsonwebtoken update)
```

### Codebase scan

```bash
$ grep -rn "passport-jwt\|JwtStrategy\|JwtModule\|verify.*jwt" src --include="*.ts"
# Verify whether passport-jwt is actually used in the auth flow
```

⚠️ **Action item**: confirm whether `passport-jwt` is used to verify Privy tokens, or whether it's just a stale dependency. The Privy SDK likely has its own verifier (`PrivyService` in this codebase uses `@privy-io/server-auth`).

## Impact

- **If passport-jwt is active for verification**: an attacker can forge a JWT whose signature passes verification → full auth bypass.
- **If it's just an unused dependency**: low risk, still update.

## Recommended Solution

### 1. Audit usage

```bash
# Check actual usage
grep -rn "passport-jwt\|JwtStrategy\|JwtAuthGuard\|@nestjs/jwt" src --include="*.ts"
```

If unused:
```bash
pnpm remove passport-jwt @types/passport-jwt
```

### 2. Update to a patched version

If used:
```bash
pnpm update passport-jwt jsonwebtoken
pnpm audit | grep -E "jws|passport"
```

`package.json` override:
```json
{
  "pnpm": {
    "overrides": {
      "jws": "^4.0.0",
      "jsonwebtoken": "^9.0.2"
    }
  }
}
```

### 3. Migrate to `jose` (recommended)

`jose` is a modern, actively maintained JWT library with no jws dep:

```bash
pnpm remove passport-jwt jsonwebtoken
pnpm add jose
```

```typescript
import { jwtVerify, createRemoteJWKSet } from "jose";

const JWKS = createRemoteJWKSet(new URL("https://your-issuer/.well-known/jwks.json"));

const { payload } = await jwtVerify(token, JWKS, {
    issuer: "https://your-issuer",
    audience: "your-app",
});
```

## Verification

```bash
pnpm audit --json | jq '.advisories | to_entries[] | .value | select(.module_name | test("jws|jsonwebtoken|passport-jwt"))'
# Expected: empty
```

## References

- [GHSA-869p-cjfg-cm3x](https://github.com/advisories/GHSA-869p-cjfg-cm3x)
- [jose library](https://github.com/panva/jose)
