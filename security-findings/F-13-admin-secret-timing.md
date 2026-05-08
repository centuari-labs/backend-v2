# F-13: `AdminSecretGuard` timing attack

**Severity**: 🟡 Moderate (mitigated once F-2 is fixed)
**OWASP**: A02 Cryptographic Failures
**CWE**: CWE-208 (Observable Timing Discrepancy)

## Summary

`AdminSecretGuard.canActivate` performs string comparison with the `!==` operator, which short-circuits when the first byte differs. This is a timing-attack vector — given enough requests, an attacker could derive the secret byte by byte through timing measurement.

Combined with **F-2 (no rate limit)**, this becomes feasible.

## Evidence

`src/common/guards/admin-secret.guard.ts:25`:

```typescript
if (!secret || token !== secret) {  // ⚠️ non-constant-time compare
    throw new UnauthorizedException("Invalid admin secret");
}
```

`ACCESS_CODE_ADMIN_SECRET` is a hex string (64 chars in `.env`). In theory, an attacker could:

1. Send a request with `token = "a" + "0" * 63`.
2. Measure response time (the server resolves the compare faster when byte 1 mismatches).
3. Iterate over 16 hex chars × 64 positions = ~1024 measurements per byte.
4. Refine with statistical analysis.

## Impact

- **Pure-language string compare in Node.js** doesn't actually have deterministic timing — V8 optimizations can mask the differences. **Practical exploitation is difficult**.
- Combined with F-2 + a LAN attacker (low jitter) it becomes feasible.
- Internet attacker: very difficult (network jitter dominates).

## Recommended Solution

### 1. Constant-time comparison

`src/common/guards/admin-secret.guard.ts`:

```typescript
import { timingSafeEqual } from "node:crypto";

@Injectable()
export class AdminSecretGuard implements CanActivate {
    constructor(private readonly configService: ConfigService) {}

    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest();
        const authHeader = request.headers.authorization;

        if (!authHeader?.startsWith("Bearer ")) {
            throw new UnauthorizedException("Missing admin secret");
        }

        const token = authHeader.slice(7);
        const secret = this.configService.get<string>("ACCESS_CODE_ADMIN_SECRET");

        if (!secret) {
            throw new UnauthorizedException("Admin secret not configured");
        }

        // Constant-time comparison — buffers must be the same length
        const tokenBuf = Buffer.from(token);
        const secretBuf = Buffer.from(secret);

        if (tokenBuf.length !== secretBuf.length ||
            !timingSafeEqual(tokenBuf, secretBuf)) {
            throw new UnauthorizedException("Invalid admin secret");
        }

        return true;
    }
}
```

⚠️ **Note**: `timingSafeEqual` requires equal-length buffers. If the lengths differ, do a dummy compare to keep timing constant:

```typescript
const expected = Buffer.from(secret);
const provided = Buffer.from(token);
const padded = Buffer.alloc(expected.length);
provided.copy(padded);

const ok = timingSafeEqual(padded, expected) && provided.length === expected.length;
if (!ok) throw new UnauthorizedException("Invalid admin secret");
```

### 2. Defense in depth

- **Fix F-2** (global rate limit) — reduces attempts per second.
- **Audit log**: log every admin auth attempt (success and failure):
  ```typescript
  this.logger.warn(`ADMIN_AUTH ip=${ip} success=${ok}`);
  ```
- **Alert on failed admin auth**: trigger an alert when there are >10 failures/min from a single IP.

### 3. Migrate to a proper admin auth model

Long term: replace the shared secret with one of:
- API keys backed by a database lookup (timing-safe lookup with bcrypt-hashed keys).
- An admin role in the database, JWT-based auth with role claims.

## Verification

Code review with semgrep:
```bash
semgrep --config=p/javascript --pattern '$X !== $Y' src/common/guards/
# Manually review all matches
```

Manual test (e.g. a `python3 timing_attack.py` script — out of scope for this verification step; just confirm the implementation uses `timingSafeEqual`).

## References

- [CWE-208: Observable Timing Discrepancy](https://cwe.mitre.org/data/definitions/208.html)
- [Node.js: timingSafeEqual](https://nodejs.org/api/crypto.html#cryptotimingsafeequala-b)
