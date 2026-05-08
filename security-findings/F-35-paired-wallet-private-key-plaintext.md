# F-35: Paired-wallet private keys are generated server-side, persisted plaintext, and returned over HTTP

**Severity**: 🔴 Critical (financial / cryptographic)
**OWASP**: A02 Cryptographic Failures, A04 Insecure Design
**CWE**: CWE-312 (Cleartext Storage of Sensitive Information), CWE-319 (Cleartext Transmission of Sensitive Information), CWE-321 (Use of Hard-coded Cryptographic Key)

## Summary

`/auth/validate` generates a fresh secp256k1 keypair on the server with `viemService.generateWallet()`, persists the **private key as a plaintext string column** (`paired_wallet_primary_key`) in `deposit_wallets`, and returns the same private key in the HTTP response body. The endpoint is unauthenticated.

The `deposit_wallets` table doesn't currently exist (no migration creates it — see F-17 functional bugs), so the path crashes on insert today. But the code is shipped, the DTO is declared, the response shape is defined. The first migration that adds the table activates a critical flaw: an attacker can POST any wallet address and receive a server-generated private key in the response, with the same key also stored in plaintext server-side.

This pattern combines the worst of three failure modes: cleartext-at-rest, cleartext-in-transit, and a custodial private key the user never sees being created on their behalf.

## Evidence

### Server-side keygen and plaintext persistence

`src/core/viem/viem.service.ts:171-179`:

```typescript
generateWallet(): { address: string; privateKey: string } {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    return {
        address: account.address,
        privateKey,                       // ⚠️ raw 32-byte hex string
    };
}
```

`src/auth/auth.service.ts:22-50`:

```typescript
async validateAndCreateDepositWallet(walletAddress: string): Promise<DepositWalletResponse> {
    if (!this.viemService.isValidAddress(walletAddress)) {
        throw new BadRequestException("Invalid wallet address format");
    }

    const pairedWallet = this.viemService.generateWallet();

    const depositWallet = await this.databaseService.insert<DepositWalletResponse>(
        "deposit_wallets",
        {
            wallet_address: walletAddress,
            paired_wallet_address: pairedWallet.address,
            paired_wallet_primary_key: pairedWallet.privateKey,   // ⚠️ plaintext
        },
    );

    this.logger.log(
        `Created deposit wallet for ${walletAddress} with paired address ${pairedWallet.address}`,
    );

    return depositWallet;             // ⚠️ contains paired_wallet_primary_key
}
```

### Returned in the HTTP response

`src/auth/dto/validate-wallet.dto.ts:11-17`:

```typescript
export interface DepositWalletResponse {
    id: number;
    wallet_address: string;
    paired_wallet_address: string;
    paired_wallet_primary_key: string;   // ⚠️ private key in API response shape
}
```

`src/auth/auth.controller.ts:27-33`:

```typescript
@Post("validate")
async validate(
    @Body() body: ValidateWalletDto,
): Promise<DepositWalletResponse> {
    return this.authService.validateAndCreateDepositWallet(
        body.wallet_address,
    );
}
```

No `@UseGuards(AuthGuard)`. Anyone can POST a wallet address.

### Nobody reads the column back

```bash
$ grep -rn "paired_wallet_primary_key\|pairedWalletPrimaryKey" src --include="*.ts" \
    | grep -v "test\|spec\|dist"

src/auth/auth.service.ts:40:                    paired_wallet_primary_key: pairedWallet.privateKey,
src/auth/dto/validate-wallet.dto.ts:16:    paired_wallet_primary_key: string;
```

The column is never read, decrypted, or used to sign anything in the current backend. Whatever the design intent is (presumably: the operator-side worker would later use the paired key to relay deposits to the treasury), the storage shape commits to plaintext.

### Migration status

```bash
$ grep -rn "deposit_wallets\|paired_wallet_primary" src/core/database/migrations/ 2>/dev/null
# (no results — the table doesn't exist yet)

$ docker exec postgres psql -U centuari -d centuari -c "\d deposit_wallets"
# ERROR: relation "deposit_wallets" does not exist
```

## Impact

### Today (table doesn't exist)

- The endpoint always 500s on insert. Functionally dead. **No active exploitation, but the code is staged.**

### As soon as a migration adds `deposit_wallets`

Combined with the existing controller code, every concern below activates:

- **F-35.1 — Mass key extraction over HTTP**. The endpoint is unauthenticated. An attacker loops `POST /auth/validate` with any wallet address (even one they don't own) and receives a server-generated private key per request. Each key is also persisted in the DB tied to the requested wallet. Combined with whatever later code path uses these keys for deposits, an attacker harvests private keys at scale.

- **F-35.2 — Cleartext at rest**. `paired_wallet_primary_key` is `text`. Backups, read-replicas, ad-hoc exports, snapshot disks, `pg_dump` files, even Postgres' transaction log — all carry the keys in plaintext. Any DB-side compromise (ransomware, misconfigured S3 bucket holding `pg_dump.gz`, leaked DBA credentials, SQL injection — see F-17 future risk) is an immediate keychain compromise.

- **F-35.3 — Cleartext in transit**. The HTTP response body contains the private key. Even if TLS terminates correctly at the edge, the key passes through the load balancer, the application server's logging stack (some logging middlewares serialize entire response bodies on errors), client-side telemetry / Sentry-style scoops, browser dev tools, and possibly back-end caches. Any one of those leaks the key.

- **F-35.4 — Predictable scope**: every user paired with this server-side key only as long as the server holds it. If the team rotates `OPERATOR_PRIVATE_KEY` (per F-1 / F-26) but doesn't migrate `deposit_wallets`, the paired keys persist with stale linking. There's no rotation primitive.

- **F-35.5 — Combined with F-1**: `.env` is in the repo, so a future engineer copying patterns ("we already store crypto material in env / DB plaintext") may not flag this as anomalous.

- **F-35.6 — Combined with F-14 / F-22**: an `Internal server error: ...` from a downstream insert failure could echo back the row that includes the private key, depending on which Postgres error-formatting layer gets the row data attached.

### Architectural issue regardless of storage hardening

The fundamental anti-pattern is **the server generating the private key**. Even with column-level encryption (KMS, `pgcrypto`), the server has the cleartext at the moment of generation and at every use, and the user must trust the server forever. This is incompatible with the typical Web3 trust model.

## Recommended Solution

### 1. (Most-defensive) Eliminate server-side keygen entirely

The user already has a wallet (Privy / EOA / smart wallet). There is no security reason for the server to mint a "paired" key on their behalf. If the goal is to identify a deposit address per user, derive a deterministic *salt-but-not-secret* identifier the user controls — never a private key.

If the design genuinely needs a deposit-relay account per user, the recommended replacement is one of:

- **CREATE2-deployed deposit proxies**: a single deployer pre-computes a per-user deposit contract address. Deposits land at that address; an immutable proxy forwards to the treasury. No per-user key exists. Compatible with standard L2 patterns (e.g. Pessimistic CREATE2 vaults).
- **EIP-2930 access lists / Permit2**: user signs a permit allowing the operator to pull funds. No new key.
- **Account abstraction (ERC-4337) deposit accounts** with the user as the sole owner key.

Pick whichever matches the team's threat model; in all of them, the server never holds a private key on behalf of the user.

### 2. If the paired-wallet design is non-negotiable, encrypt at rest with KMS / `pgcrypto` and never return the key

Schema (with `pgcrypto`):

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE deposit_wallets (
    id BIGSERIAL PRIMARY KEY,
    wallet_address TEXT NOT NULL UNIQUE,
    paired_wallet_address TEXT NOT NULL UNIQUE,
    paired_wallet_primary_key_encrypted BYTEA NOT NULL,  -- ⚠️ never stored cleartext
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Service:

```typescript
import { createCipheriv, randomBytes } from "node:crypto";

private async encryptKey(privKey: string): Promise<Buffer> {
    // Use AWS KMS / GCP KMS to wrap a per-row data key. Below is illustrative AES-GCM
    // with a master key that itself comes from a KMS-decrypted env at boot.
    const dataKey = await this.kms.generateDataKey();          // returns plaintext DK + encrypted DK
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", dataKey.plaintext, iv);
    const ciphertext = Buffer.concat([cipher.update(privKey, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([dataKey.encrypted, iv, tag, ciphertext]);
}

async validateAndCreateDepositWallet(walletAddress: string): Promise<DepositWalletPublicResponse> {
    if (!this.viemService.isValidAddress(walletAddress)) {
        throw new BadRequestException("Invalid wallet address format");
    }
    const paired = this.viemService.generateWallet();
    const enc = await this.encryptKey(paired.privateKey);

    await this.depositWalletsRepo.save({
        wallet_address: walletAddress.toLowerCase(),
        paired_wallet_address: paired.address.toLowerCase(),
        paired_wallet_primary_key_encrypted: enc,
    });

    // Return PUBLIC fields only — never the private key.
    return {
        wallet_address: walletAddress.toLowerCase(),
        paired_wallet_address: paired.address.toLowerCase(),
    };
}
```

Update `DepositWalletResponse` to remove `paired_wallet_primary_key`. Anything that previously consumed it from the API must be reworked — it has no business leaving the server.

### 3. Auth + rate-limit even if the design changes

`/auth/validate` should:

- Run under `@UseGuards(AuthGuard)` so only an authenticated user can request a paired wallet.
- Bind to the authenticated wallet — drop the body's `wallet_address` field; use `req.user.walletAddress`. Otherwise users can mint paired wallets for arbitrary addresses (still concerning even with hardened storage).
- Have an idempotency / per-wallet uniqueness constraint so each user gets exactly one paired wallet, retrievable but never re-mintable.
- Be throttled per IP and per wallet (after F-2 wires the global throttler).

```typescript
@Post("validate")
@UseGuards(AuthGuard, WalletThrottlerGuard)
@Throttle({ default: { limit: 1, ttl: 24 * 60 * 60 * 1000 } })
async validate(@Wallet() walletAddress: string): Promise<DepositWalletPublicResponse> {
    return this.authService.getOrCreateDepositWallet(walletAddress);
}
```

`getOrCreateDepositWallet` returns the existing row if one exists for this user — never mints a second paired wallet.

### 4. Audit logging without leaking the key

Today the service logs:

```typescript
this.logger.log(
    `Created deposit wallet for ${walletAddress} with paired address ${pairedWallet.address}`,
);
```

Already only logs the public address — good. **Do not** add any debug log that includes the private key. CI lint rule:

```yaml
# .semgrep.yml
rules:
  - id: log-private-key
    pattern-either:
      - pattern: $L($M, ..., $X.privateKey, ...)
      - pattern: $L(`...${$X.privateKey}...`)
    message: "Never log a private key"
    languages: [typescript]
    severity: ERROR
```

### 5. If keys must ever exist server-side, gate access behind dual control

For services that need to use the paired key (e.g. a relayer that forwards deposits), require:

- Decryption only inside a sealed signing service (not the main backend process).
- mTLS between the backend and the signer.
- Rate / amount limits enforced by the signer, not by the caller.

This is the same posture recommended in F-26 for the operator key.

### 6. Migration must NOT be a simple `CREATE TABLE`

If the team decides to add `deposit_wallets`, the migration:

- Adds the encrypted column from day one.
- Includes a `pgcrypto` enable step or KMS connection check.
- Has a downgrade path that doesn't leave plaintext keys behind.

A naïve `CREATE TABLE deposit_wallets (..., paired_wallet_primary_key TEXT NOT NULL, ...);` migration would activate the current critical flaw and is the *most likely* migration to land if no one re-reads `auth.service.ts` while writing it.

## Verification

```bash
# 1. The endpoint is now authenticated
curl -X POST http://localhost:8080/auth/validate \
    -H "Content-Type: application/json" \
    -d '{"wallet_address":"0x1111111111111111111111111111111111111111"}'
# Expected: 401

# 2. Even with auth, the response has no private key
curl -X POST http://localhost:8080/auth/validate \
    -H "Authorization: Bearer DEV_TOKEN_0x..." \
    -H "Content-Type: application/json" \
    -d '{}'   # body fields ignored after refactor
# Expected: 200 with { wallet_address, paired_wallet_address } only.

# 3. The DB row stores ciphertext
docker exec postgres psql -U centuari -d centuari -c \
    "SELECT octet_length(paired_wallet_primary_key_encrypted), paired_wallet_address FROM deposit_wallets LIMIT 1;"
# Expected: a binary length, no plaintext anywhere.

# 4. Property test: any value of `paired_wallet_primary_key` field anywhere in the API surface is a regression.
grep -rn "paired_wallet_primary_key\|pairedWalletPrimaryKey" src --include="*.ts" \
    | grep -v "_encrypted"
# Expected: empty.
```

## References

- [OWASP A02:2021 — Cryptographic Failures](https://owasp.org/Top10/A02_2021-Cryptographic_Failures/)
- [CWE-312: Cleartext Storage of Sensitive Information](https://cwe.mitre.org/data/definitions/312.html)
- [CWE-321: Use of Hard-coded Cryptographic Key](https://cwe.mitre.org/data/definitions/321.html) — closely related to "server-managed user key"
- [Postgres pgcrypto](https://www.postgresql.org/docs/current/pgcrypto.html)
- [AWS KMS envelope encryption](https://docs.aws.amazon.com/kms/latest/developerguide/concepts.html#enveloping)
- [CREATE2 deposit-vault pattern (Optimism)](https://docs.optimism.io/builders/dapp-developers/contracts/create2)
- Real-world: [Wintermute hot-wallet leak via vanity-address tooling (2022)](https://rekt.news/wintermute-rekt/)
