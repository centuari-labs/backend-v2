# F-9: Race condition in `redeemAccessCode`

**Severity**: 🔴 Critical
**OWASP**: A04 Insecure Design
**CWE**: CWE-362 (Concurrent Execution using Shared Resource — TOCTOU)

## Summary

`AuthService.redeemAccessCode` performs a check-then-act sequence with no transaction or row lock. As a result, a single-use access code (`max_uses=1`) can be redeemed by many users concurrently.

## Evidence

`src/auth/auth.service.ts:79-118` (excerpt):

```typescript
async redeemAccessCode(privyUserId: string, code: string) {
    const accessCode = await this.databaseService.queryOne(...);
    if (!accessCode) throw new BadRequestException("Invalid access code");

    // ⚠️ Check happens here
    if (accessCode.max_uses !== -1 &&
        accessCode.current_uses >= accessCode.max_uses) {
        throw new BadRequestException("Access code has reached its usage limit");
    }

    // ... idempotency check ...

    // ⚠️ Increment happens HERE — race window between check and update
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
}
```

### Active exploit confirmed

```bash
# Setup: generate 1 code with max_uses=1
$ curl -s -X POST http://localhost:8080/auth/access-codes/generate \
    -H "Authorization: Bearer $ADMIN_SECRET" \
    -d '{"count":1,"max_uses":1,"prefix":"RACETEST"}'
# → code: RACETEST-FN6J8

# Race: 10 concurrent redeems from 10 different users
$ for i in $(seq 1 10); do
    W="0x$(printf '%040d' $i)"
    curl -s -X POST http://localhost:8080/auth/redeem-access-code \
      -H "Authorization: Bearer DEV_TOKEN_$W" \
      -d '{"code":"RACETEST-FN6J8"}' &
  done; wait

# Results: 5x {"granted":true}, 5x "Access code has reached its usage limit"

# DB confirms:
$ docker exec postgres psql -U centuari -d centuari -c \
    "SELECT current_uses, max_uses FROM access_codes WHERE code='RACETEST-FN6J8';"
 current_uses | max_uses
--------------+----------
            5 |        1   ← max_uses=1, but current_uses=5
```

**A single-use code was redeemed 5 times by 5 different users**, all of whom received `access_granted=true`.

## Impact

- **F-9.1 — Whitelist/beta bypass**: if access codes gate beta access, an attacker with one leaked code can onboard thousands of accounts.
- **F-9.2 — Combined with F-1**: `ACCESS_CODE_ADMIN_SECRET` in the repo + this race = unlimited access codes (generate one, mass-redeem it).
- **F-9.3 — Audit trail**: the `access_code_redemptions` table holds N rows for a `max_uses=1` code → consistency issues, harder forensics.
- **F-9.4 — Combined with F-2 (no rate limit)**: the race window is amplified, allowing hundreds of concurrent redeems.

## Recommended Solution

### Solution: atomic UPDATE with conditional WHERE

Replace the check-then-update pattern with a single atomic UPDATE that returns rows on success:

```typescript
async redeemAccessCode(privyUserId: string, code: string) {
    // Idempotency: if user has already redeemed any code, just ensure the flag is set
    const existing = await this.databaseService.queryOne(
        "SELECT 1 FROM access_code_redemptions WHERE privy_user_id = $1 LIMIT 1",
        [privyUserId],
    );
    if (existing) {
        await this.databaseService.query(
            "UPDATE accounts SET access_granted = true WHERE privy_user_id = $1",
            [privyUserId],
        );
        return { granted: true };
    }

    // 🔒 Atomic: claim a slot only if the code is valid AND has capacity
    const claim = await this.databaseService.queryOne<{ id: string }>(
        `UPDATE access_codes
         SET current_uses = current_uses + 1
         WHERE code = $1
           AND is_active = true
           AND (max_uses = -1 OR current_uses < max_uses)
           AND (expires_at IS NULL OR expires_at > NOW())
         RETURNING id`,
        [code],
    );

    if (!claim) {
        // Either the code doesn't exist, is inactive, expired, or exhausted.
        // Differentiate for better UX:
        const exists = await this.databaseService.queryOne(
            "SELECT is_active, expires_at, current_uses, max_uses FROM access_codes WHERE code = $1",
            [code],
        );
        if (!exists || !exists.is_active) {
            throw new BadRequestException("Invalid access code");
        }
        if (exists.expires_at && new Date(exists.expires_at) < new Date()) {
            throw new BadRequestException("Access code has expired");
        }
        throw new BadRequestException("Access code has reached its usage limit");
    }

    // Insert redemption + grant access (best-effort; redemption table is the audit log)
    await this.databaseService.query(
        "INSERT INTO access_code_redemptions (access_code_id, privy_user_id) VALUES ($1, $2)",
        [claim.id, privyUserId],
    );
    await this.databaseService.query(
        "UPDATE accounts SET access_granted = true WHERE privy_user_id = $1",
        [privyUserId],
    );

    this.logger.log(`Access code redeemed by privy user ${privyUserId}`);
    return { granted: true };
}
```

### Alternative: full transaction with row lock

If you prefer wrapping in a transaction:

```typescript
async redeemAccessCode(privyUserId: string, code: string) {
    return this.dataSource.transaction(async (manager) => {
        const result = await manager.query(
            `SELECT id, max_uses, current_uses, is_active, expires_at
             FROM access_codes
             WHERE code = $1
             FOR UPDATE`,  // 🔒 row-level lock
            [code],
        );
        const accessCode = result[0];

        if (!accessCode || !accessCode.is_active) {
            throw new BadRequestException("Invalid access code");
        }
        if (accessCode.expires_at && new Date(accessCode.expires_at) < new Date()) {
            throw new BadRequestException("Access code has expired");
        }
        if (accessCode.max_uses !== -1 &&
            accessCode.current_uses >= accessCode.max_uses) {
            throw new BadRequestException("Access code has reached its usage limit");
        }

        await manager.query(
            "UPDATE access_codes SET current_uses = current_uses + 1 WHERE id = $1",
            [accessCode.id],
        );
        await manager.query(
            "INSERT INTO access_code_redemptions (access_code_id, privy_user_id) VALUES ($1, $2)",
            [accessCode.id, privyUserId],
        );
        await manager.query(
            "UPDATE accounts SET access_granted = true WHERE privy_user_id = $1",
            [privyUserId],
        );

        return { granted: true };
    });
}
```

**Recommendation: Solution A (atomic UPDATE)** — simpler, less lock contention, single round trip.

### Defense-in-depth: DB constraints

Add a CHECK constraint or partial unique index to prevent over-redemption at the DB level:

```sql
-- Prevent the same user from claiming the same code twice
CREATE UNIQUE INDEX idx_redemption_user_code
    ON access_code_redemptions (access_code_id, privy_user_id);

-- Sanity check at row level
ALTER TABLE access_codes
    ADD CONSTRAINT chk_uses_within_max
    CHECK (max_uses = -1 OR current_uses <= max_uses);
```

Note: the CHECK constraint only validates per-row; it does not prevent races, but it catches any logic bug that writes `current_uses > max_uses`.

### Clean up legacy data

```sql
-- Audit existing over-redemption
SELECT
    ac.code,
    ac.max_uses,
    ac.current_uses,
    COUNT(acr.id) AS actual_redemptions
FROM access_codes ac
LEFT JOIN access_code_redemptions acr ON acr.access_code_id = ac.id
GROUP BY ac.id
HAVING ac.max_uses != -1 AND ac.current_uses > ac.max_uses;

-- Decide policy: revoke `access_granted` for over-redeemers? Or grandfather them?
```

## Verification

```bash
# After patch
ADMIN_SECRET=$(grep ACCESS_CODE_ADMIN_SECRET .env | cut -d= -f2)
GEN=$(curl -s -X POST http://localhost:8080/auth/access-codes/generate \
  -H "Authorization: Bearer $ADMIN_SECRET" \
  -d '{"count":1,"max_uses":1,"prefix":"VERIFY"}')
CODE=$(echo $GEN | jq -r '.data.codes[0].code')

# 10 concurrent redeems
for i in $(seq 1 10); do
  W="0x$(printf '%040d' $i)"
  curl -s -o /tmp/r$i -X POST http://localhost:8080/auth/redeem-access-code \
    -H "Authorization: Bearer DEV_TOKEN_$W" \
    -H "Content-Type: application/json" \
    -d "{\"code\":\"$CODE\"}" &
done; wait

grep -l '"granted":true' /tmp/r* | wc -l
# Expected: 1   (only one wins)

docker exec postgres psql -U centuari -d centuari -c \
  "SELECT current_uses FROM access_codes WHERE code='$CODE';"
# Expected: 1
```

## References

- [PostgreSQL: Atomic UPDATE patterns](https://www.postgresql.org/docs/current/sql-update.html)
- [OWASP A04:2021 — Insecure Design](https://owasp.org/Top10/A04_2021-Insecure_Design/)
- [CWE-362: TOCTOU](https://cwe.mitre.org/data/definitions/362.html)
- [Martin Fowler: Reducing concurrency bugs with constraints](https://martinfowler.com/articles/patterns-of-distributed-systems/)
