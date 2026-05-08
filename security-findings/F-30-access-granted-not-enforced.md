# F-30: `access_granted` flag is set on redemption but never read — entire access-code gate is decorative

**Severity**: 🟠 High
**OWASP**: A01 Broken Access Control, A04 Insecure Design
**CWE**: CWE-862 (Missing Authorization), CWE-285 (Improper Authorization)

## Summary

`AuthService.redeemAccessCode` updates `accounts.access_granted = true` for the redeeming user, and the codebase exposes admin endpoints to generate / list / deactivate codes (`POST /auth/access-codes/generate`, etc.). But **no production code path ever reads `access_granted`**. Every authenticated endpoint — orders, withdraw, repay, portfolio queries, etc. — passes through `AuthGuard` only, which never consults this column.

Result: the entire access-code system is functionally non-existent for security purposes. Beta/whitelist gating, if that's what the codes are for, is bypassed by anyone who can authenticate. Combined with **F-9** (race lets a single code be redeemed N times) and **F-1** (admin secret in repo), this is a complete bypass with no actual gate to bypass.

## Evidence

### Where `access_granted` is written

`src/auth/auth.service.ts:103,119`:

```typescript
// Idempotent: if user already redeemed any code, just ensure flag is set
await this.databaseService.query(
    "UPDATE accounts SET access_granted = true WHERE privy_user_id = $1",
    [privyUserId],
);
return { granted: true };

// ...

// Redeem: insert redemption, increment uses, flag account
await this.databaseService.query(
    "INSERT INTO access_code_redemptions (access_code_id, privy_user_id) VALUES ($1, $2)",
    [accessCode.id, privyUserId],
);
await this.databaseService.query(
    "UPDATE access_codes SET current_uses = current_uses + 1 WHERE id = $1",
    [accessCode.id],
);
await this.databaseService.query(
    "UPDATE accounts SET access_granted = true WHERE privy_user_id = $1",
    [privyUserId],
);
```

### Where `access_granted` is *never* read

```bash
$ grep -rnE 'access_granted\b|accessGranted\b' src --include="*.ts" \
    | grep -v 'test|spec|migration|UPDATE.*access_granted'

# (no results)
```

The only references in production code are the two `UPDATE` statements above. There is no:

- Guard reading the column.
- Service-layer check before placing orders, withdrawing, repaying.
- WebSocket handshake check.
- Admin-side enforcement.

### Account schema confirms the column exists and defaults to false

`src/orders/entities/account.entity.ts` (or migration):

```sql
access_granted BOOLEAN NOT NULL DEFAULT false
```

So new accounts start ungated, and the flag never matters.

## Impact

- **F-30.1 — Beta gate bypass**: if access codes were intended to limit who can interact with the protocol during a closed beta, anyone who can complete `POST /auth/login` is in. No code redemption needed.
- **F-30.2 — Combined with F-1 + F-9**: an attacker doesn't even need to log in legitimately — they can take the leaked `ACCESS_CODE_ADMIN_SECRET` from `.env`, generate themselves codes, redeem them in a race-amplified way, and have the `access_granted` flag set on N accounts. But since the flag is never enforced, the entire dance is theatrical.
- **F-30.3 — Defense-in-depth illusion**: developers and operators may believe "access codes" are a defensive layer (visible to security review, mentioned in comments). The presence of unenforced security UI is worse than no UI — it gives a false sense of safety. Future PRs may rely on it ("this feature is only for whitelisted users via access code") without realizing the gate is open.
- **F-30.4 — Admin endpoint footprint without effect**: `POST /auth/access-codes/generate`, `GET /auth/access-codes`, `PATCH /auth/access-codes/:id/deactivate` are all gated by `AdminSecretGuard`. They exist, they require a secret to call, and they do nothing materially for security. Maintenance liability.

## Recommended Solution

There are two clean fixes; pick one based on intent.

### Option A — Enforce the flag on every authenticated route (recommended if access codes are a beta gate)

Add a second guard that runs after `AuthGuard` and rejects ungated accounts:

```typescript
// src/common/guards/access-granted.guard.ts
import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
} from "@nestjs/common";
import { OrderRepository } from "../../orders/repositories/order.repository";

@Injectable()
export class AccessGrantedGuard implements CanActivate {
    constructor(private readonly orderRepository: OrderRepository) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const req = context.switchToHttp().getRequest();
        const user = req.user;
        if (!user?.userId) {
            // AuthGuard should have already enforced this, but be defensive.
            throw new ForbiddenException("Not authenticated");
        }
        const account = await this.orderRepository.findAccountByPrivyUserId(user.userId);
        if (!account?.accessGranted) {
            throw new ForbiddenException("Access code redemption required");
        }
        return true;
    }
}
```

Apply with `AuthGuard`:

```typescript
@Controller("orders")
@UseGuards(AuthGuard, AccessGrantedGuard, WalletThrottlerGuard)
export class OrdersController { ... }

@Controller("withdraw")
export class WithdrawController {
    @Post()
    @UseGuards(AuthGuard, AccessGrantedGuard)
    async withdraw(...) { ... }
}

@Controller("portfolio")
@UseGuards(AuthGuard, AccessGrantedGuard)
export class PortfolioController { ... }
```

Carve out endpoints that should remain available pre-redemption:

- `POST /auth/login` — must run pre-gate.
- `POST /auth/redeem-access-code` — must run pre-gate.
- `GET /me` — pre-gate (so the UI can show "you need a code" state).
- `GET /market`, `/market/:assetId`, `/market/:assetId/rate-history` — public reads.

For the WebSocket gateway (after F-15 wires auth), enforce the same check on the handshake.

### Option B — Remove the system entirely if the gate isn't actually intended

If the team has decided access codes aren't a hard gate (e.g. they were an early-onboarding hack), delete the code path so it doesn't mislead future readers:

- Remove `access_granted` column (migration + entity).
- Remove `redeemAccessCode`, `generateAccessCodes`, `listAccessCodes`, `deactivateAccessCode`.
- Remove the three admin endpoints.
- Drop `AdminSecretGuard` if nothing else uses it.

This eliminates the maintenance liability and the false-sense-of-security risk.

### Defense in depth either way

- Cache the `accessGranted` value per `userId` for ~30 s (memory) so the new guard doesn't add a DB hit per request.
- Log every `403 access-code required` rejection with the user id to detect probing.
- Add a property test that fails CI if any `*.controller.ts` adds an `@UseGuards(AuthGuard)` without also including `AccessGrantedGuard` (or an explicit `@Public()` annotation).

## Verification

```bash
# After Option A is applied:

# 1. New account, no code redeemed → orders should be 403
TOK=DEV_TOKEN_0xfreshaccount000000000000000000000000000
curl -X POST http://localhost:8080/orders/lend/limit \
    -H "Authorization: Bearer $TOK" \
    -d '{"assetId":"...","amount":"100","marketIds":["..."],"rate":500}'
# Expected: 403 "Access code redemption required".

# 2. Redeem a code → orders should now be 201
ADMIN=$(grep ACCESS_CODE_ADMIN_SECRET .env | cut -d= -f2)
GEN=$(curl -s -X POST http://localhost:8080/auth/access-codes/generate \
    -H "Authorization: Bearer $ADMIN" \
    -d '{"count":1,"max_uses":1,"prefix":"GATE"}')
CODE=$(echo "$GEN" | jq -r '.data.codes[0].code')
curl -X POST http://localhost:8080/auth/redeem-access-code \
    -H "Authorization: Bearer $TOK" -d "{\"code\":\"$CODE\"}"
curl -X POST http://localhost:8080/orders/lend/limit \
    -H "Authorization: Bearer $TOK" \
    -d '{"assetId":"...","amount":"100","marketIds":["..."],"rate":500}'
# Expected: 201 (or whatever the post-fix order-create response is after F-29).

# 3. Pre-gate endpoints still reachable without redemption
curl http://localhost:8080/me -H "Authorization: Bearer $TOK"   # Expected: 200
curl http://localhost:8080/auth/redeem-access-code ...           # Expected: 200/400 (not 403)
```

## References

- [OWASP A01:2021 — Broken Access Control](https://owasp.org/Top10/A01_2021-Broken_Access_Control/)
- [CWE-285: Improper Authorization](https://cwe.mitre.org/data/definitions/285.html)
- [NestJS Guards composition](https://docs.nestjs.com/guards#binding-guards)
