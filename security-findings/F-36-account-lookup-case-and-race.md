# F-36: `getOrCreateAccount` is case-sensitive and racy — duplicate-account 500s and split state

**Severity**: 🟡 Moderate (turns into High when combined with F-32 and F-26)
**OWASP**: A04 Insecure Design, A07 Identification & Auth Failures
**CWE**: CWE-178 (Improper Handling of Case Sensitivity), CWE-362 (Concurrent Execution using Shared Resource — Race Condition), CWE-694 (Use of Multiple Resources with Duplicate Identifier)

## Summary

`OrderRepository.getOrCreateAccount` uses an exact-case lookup on `accounts.user_wallet`, then naïvely creates a new row on a miss with no handling for the unique-constraint collision on `privy_user_id`. It produces three symptoms:

1. **Case-induced duplicate accounts** — a request with `0xABC…` doesn't find the existing `0xabc…` row, so the service tries to insert. The insert violates `uq_privy_user_id` (since dev userIds are always lowercase), and the request crashes with a 500.
2. **Concurrent first-login race** — two requests from the same wallet arrive together, both `findOne` returns null, both try to insert, the second fails on the unique constraint with no retry.
3. **Split state when paired with `loginOrCreateAccount`** — `loginOrCreateAccount` (in `auth.service.ts`) does a SQL `INSERT ... ON CONFLICT (privy_user_id) DO UPDATE SET user_wallet = EXCLUDED.user_wallet`. The first login overwrites the stored case to whatever the latest request used. Order/portfolio code that queries by exact-case sees nothing for that wallet between login and the next overwrite.

Combined with F-32 (dev-auth strategy preserves token casing — `DEV_TOKEN_0xABC…` passes the wallet through verbatim) and F-26 (operator signs withdraws to whatever address the backend authorized), the case-sensitivity bug becomes a withdraw-blocker at best and an auth-confusion vector at worst.

## Evidence

`src/orders/repositories/order.repository.ts:60-78`:

```typescript
async getOrCreateAccount(walletAddress: string, privyUserId: string): Promise<Account> {
    let account = await this.accountRepository.findOne({
        where: { userWallet: walletAddress },     // ⚠️ exact case
    });

    if (!account) {
        account = this.accountRepository.create({
            userWallet: walletAddress,             // ⚠️ stored verbatim
            privyUserId: privyUserId,
        });
        account = await this.accountRepository.save(account);   // ⚠️ no retry, no upsert
    }

    return account;
}
```

`src/orders/repositories/order.repository.ts:129-136` (sister query that *does* normalize):

```typescript
async findAccountByWallet(walletAddress: string): Promise<Account | null> {
    return this.accountRepository
        .createQueryBuilder("account")
        .where("LOWER(account.user_wallet) = LOWER(:walletAddress)", { walletAddress })
        .getOne();
}
```

So the codebase has *both* lookup styles. `findAccountByWallet` is case-insensitive (correct), `getOrCreateAccount` is case-sensitive (buggy). They're called from different services on different code paths — see callers below.

`src/auth/auth.service.ts:51-65`:

```typescript
async loginOrCreateAccount(privyUserId: string, walletAddress: string) {
    const account = await this.databaseService.queryOne(
        `INSERT INTO accounts (privy_user_id, user_wallet)
         VALUES ($1, $2)
         ON CONFLICT (privy_user_id) DO UPDATE SET user_wallet = EXCLUDED.user_wallet
         RETURNING *`,
        [privyUserId, walletAddress],         // ⚠️ overwrites stored case on every login
    );
    ...
}
```

`src/common/guards/strategies/dev-auth.strategy.ts:23-37`:

```typescript
const walletAddress = token.slice(DevAuthStrategy.PREFIX.length);
if (!walletAddress || !walletAddress.startsWith("0x")) { throw ... }
return {
    userId: `dev-user-${walletAddress.toLowerCase()}`,
    walletAddress,                             // ⚠️ NOT lowercased
};
```

So the `walletAddress` flowing into `getOrCreateAccount` is whatever case the token carried. A user / attacker who alternates `DEV_TOKEN_0xABC…` and `DEV_TOKEN_0xabc…` produces two writes to the same `privy_user_id` (lowercased) but different `user_wallet` values, with `loginOrCreateAccount`'s `ON CONFLICT` flipping the column back and forth.

## Impact

### Symptom matrix

| Caller | Path | Behavior on case mismatch |
|--------|------|---------------------------|
| `prepareOrder` → `getOrCreateAccount` (orders.service.ts) | exact case | finds nothing → insert → unique constraint violation → 500 |
| `repay.service.ts:repay` → `getOrCreateAccount` | exact case | same |
| `withdrawLendPosition` → `getOrCreateAccount` | same |
| `withdraw.service.ts:withdraw` → `findAccountByWallet` | LOWER compare | always finds the row |
| `portfolio.service.ts:*` → `findAccountByWallet` | LOWER | finds row |
| `auth.service.ts:loginOrCreateAccount` | upsert by `privy_user_id` | overwrites `user_wallet` to the new case |

Net behavior:

- Login-then-place-order with consistent casing: works.
- Login-then-place-order with mismatched casing across requests (e.g. front-end sends mixed-case wallet, back-end normalizes one path but not another): **place-order 500s**, withdraw works.
- Two concurrent first-logins with the same wallet: **second login 500s** with `unique_violation` from the inner save call.
- Subsequent state divergence: `accounts.user_wallet` flips per login, while `getOrCreateAccount` exact-match always misses on the case the user *previously* used. UX bug; for an attacker who's mapping behavior, a useful oracle.

### Security-relevant impact (combined with other findings)

- **F-36.1 — Withdrawal/repay UX-grade DoS.** Mixed-case in dev tokens (F-32 lets dev tokens through) blocks repay and withdrawLendPosition with 500 errors instead of clean validation messages. Combined with F-14 / F-22, the 500 leaks the Postgres unique-constraint name (`uq_privy_user_id`) to clients — a small but real fingerprint.
- **F-36.2 — Forged audit trail via case-toggle.** A login at 14:01 with `0xABC…` and at 14:02 with `0xabc…` produces an `accounts` row whose latest value is the lower-case form, but matches and orders inserted at 14:01 reference the upper-case form via `accountId` (which is unchanged). The `user_wallet` column ceases to be a reliable audit field.
- **F-36.3 — Exposed 500 + leaked SQL state.** With F-2 absent (no rate limit) and F-14 leaky, an attacker can force these 500s repeatedly and harvest schema details from error responses.
- **F-36.4 — Combined with F-32 (dev auth bypass).** A production-misconfigured dev-auth deploy uses arbitrary case in dev tokens. Every wallet that has ever logged in in any case becomes an oracle — the attacker can map who's a real user (whose `getOrCreateAccount` fails with `unique_violation` because they exist under a different case) vs who isn't (insert succeeds).
- **F-36.5 — Confusion with on-chain operations.** `Treasury.withdraw(token, walletAddress, amount)` is signed by the operator with `walletAddress = req.user.walletAddress` (whatever case the auth carried). On-chain checksums are case-insensitive for matching but case-sensitive when used as keys in event/log indexing tools. Database `account_id` is the canonical reference; case-flapping hurts off-chain correlation tools (Dune-style queries, rev-share calculations).

## Reproduction

```bash
# 1. Login with lowercase
curl -X POST http://localhost:8080/auth/login \
    -H "Authorization: Bearer DEV_TOKEN_0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"
# OK → account row inserted with user_wallet=lowercase.

# 2. Try to place an order with uppercase
curl -X POST http://localhost:8080/orders/lend/limit \
    -H "Authorization: Bearer DEV_TOKEN_0xABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD" \
    -H "Content-Type: application/json" \
    -d '{"assetId":"...","amount":"100","marketIds":["..."],"rate":500}'
# Expected today: 500 with QueryFailedError unique_violation on uq_privy_user_id.
# (prepareOrder.getOrCreateAccount tries to INSERT a duplicate privy_user_id.)

# 3. Concurrent first-login race
for i in 1 2 3; do
    curl -X POST http://localhost:8080/auth/login \
        -H "Authorization: Bearer DEV_TOKEN_0xfeedfeedfeedfeedfeedfeedfeedfeedfeedfeed" &
done; wait
# Expected today: at least one 500 (loginOrCreateAccount uses upsert, but the first race
# variant is observable inside the *order placement* path on the first ever request).
```

## Recommended Solution

### 1. Normalize wallet addresses at every ingress point

Single source of truth — lowercase everywhere on the way in. Apply at the auth strategy:

`src/common/guards/strategies/dev-auth.strategy.ts`:

```typescript
const walletAddress = token.slice(DevAuthStrategy.PREFIX.length).toLowerCase();
if (!walletAddress || !walletAddress.startsWith("0x") || walletAddress.length !== 42) {
    throw new UnauthorizedException("Dev token must contain a valid wallet address");
}
return {
    userId: `dev-user-${walletAddress}`,
    walletAddress,                     // 🔒 always lowercased
};
```

Apply the same normalization to the Privy strategy:

```typescript
return {
    userId: result.userId,
    walletAddress: (result.walletAddress as string).toLowerCase(),
};
```

This eliminates case skew at the boundary so the rest of the codebase doesn't need to defend.

### 2. Fix `getOrCreateAccount` to be case-insensitive and idempotent

`src/orders/repositories/order.repository.ts`:

```typescript
async getOrCreateAccount(walletAddress: string, privyUserId: string): Promise<Account> {
    const wallet = walletAddress.toLowerCase();

    // Single statement that is safe under concurrency. Returns the existing row OR the new one.
    const rows = await this.dataSource.query<Array<Account>>(
        `INSERT INTO accounts (privy_user_id, user_wallet)
         VALUES ($1, $2)
         ON CONFLICT (privy_user_id) DO UPDATE
            SET user_wallet = EXCLUDED.user_wallet
         RETURNING *`,
        [privyUserId, wallet],
    );
    return rows[0];
}
```

Properties:

- Race-safe: Postgres serializes the upsert via the `privy_user_id` unique constraint.
- Case-stable: stored value is always lowercase.
- Idempotent: subsequent calls return the same row.

### 3. Make the column constraint case-insensitive

Add a unique index on the lower-cased value, so even direct inserts that bypass the helper get caught:

```sql
CREATE UNIQUE INDEX idx_accounts_user_wallet_lower ON accounts (LOWER(user_wallet));
ALTER TABLE accounts ADD CONSTRAINT chk_user_wallet_lowercase CHECK (user_wallet = LOWER(user_wallet));
```

The CHECK enforces the storage convention; the lower-case unique index makes lookups via `LOWER(user_wallet) = LOWER($1)` use an index seek.

### 4. Backfill existing rows

A migration:

```sql
-- One-time normalization. Coordinate with concurrent writes via advisory lock.
SELECT pg_advisory_lock(0xACC0CC);
UPDATE accounts SET user_wallet = LOWER(user_wallet) WHERE user_wallet <> LOWER(user_wallet);
SELECT pg_advisory_unlock(0xACC0CC);
```

If duplicates surfaced from the case skew (multiple `accounts` rows that differ only in case of `user_wallet`), reconcile manually before applying the unique index — pick the canonical row, repoint `orders.account_id` / `portfolio.account_id` / `borrow_positions.account_id` / `lend_positions.account_id` / `access_code_redemptions` to the canonical id, then delete the duplicates.

### 5. Drop the case-sensitive `findOne({ userWallet })` pattern

After the migration, `findOne({ userWallet: walletAddress.toLowerCase() })` is correct — but only because step 1 ensures the input is already lowercase. To prevent regressions, prefer the `LOWER(user_wallet) = LOWER(:walletAddress)` query everywhere:

```bash
$ grep -rn "userWallet:" src --include="*.ts" | grep -v "test\|spec"
# Confirm all callers either pass a known-lowercase value or use the LOWER() query.
```

### 6. Better error response on collisions (defense in depth)

If a duplicate ever surfaces despite the above (e.g. a future migration breaks the constraint), don't return a raw QueryFailedError:

```typescript
catch (err) {
    if ((err as { code?: string })?.code === "23505") {  // unique_violation
        // Race-safe: re-read and return the existing row.
        const existing = await this.accountRepository.findOne({
            where: { userWallet: wallet },
        });
        if (existing) return existing;
    }
    throw err;
}
```

(The upsert in step 2 obviates this, but keep it as a belt-and-braces check.)

## Verification

```bash
# 1. Mixed-case dev token works against repay and order placement
TOK_LO=DEV_TOKEN_0xabcdefabcdefabcdefabcdefabcdefabcdefabcd
TOK_UP=DEV_TOKEN_0xABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD

curl ... -H "Authorization: Bearer $TOK_LO"   # login
curl ... -H "Authorization: Bearer $TOK_UP"   # place order — 201 expected

# 2. Concurrent first-login is no longer racy
for i in $(seq 1 10); do
    curl -X POST http://localhost:8080/auth/login \
        -H "Authorization: Bearer DEV_TOKEN_0xnewuser000000000000000000000000000000000" \
        -o /dev/null &
done; wait
docker exec postgres psql -U centuari -d centuari -tAc \
    "SELECT count(*) FROM accounts WHERE user_wallet = '0xnewuser000000000000000000000000000000000';"
# Expected: 1.

# 3. Mixed-case insert blocked at DB layer
docker exec postgres psql -U centuari -d centuari -c \
    "INSERT INTO accounts (privy_user_id, user_wallet) VALUES ('foo', '0xMIXEDCASEWALLET0000000000000000000000000');"
# Expected: ERROR — chk_user_wallet_lowercase violation.
```

## References

- [PostgreSQL: ON CONFLICT (upsert)](https://www.postgresql.org/docs/current/sql-insert.html#SQL-ON-CONFLICT)
- [EIP-55: Mixed-case checksum address encoding](https://eips.ethereum.org/EIPS/eip-55) — note that EIP-55 *displays* mixed case but addresses are case-insensitive at the protocol level
- [CWE-178: Improper Handling of Case Sensitivity](https://cwe.mitre.org/data/definitions/178.html)
- [CWE-362: Race Condition](https://cwe.mitre.org/data/definitions/362.html)
