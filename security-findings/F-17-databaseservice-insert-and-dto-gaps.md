# F-17: Architectural risks — `DatabaseService.insert` table interpolation + missing DTO bounds

**Severity**: 🟠 High (latent — currently safe, easy to break)
**OWASP**: A03 Injection, A04 Insecure Design, A08 Software & Data Integrity
**CWE**: CWE-89 (SQL Injection), CWE-20 (Improper Input Validation)

## Summary

Two coupled architectural issues that aren't actively exploitable today but make the codebase one careless commit away from a critical bug:

1. **`DatabaseService.insert` interpolates table and column names into raw SQL.** Today the only caller hardcodes the table, but the API invites `insert(req.params.table, req.body)`-style misuse.
2. **Most DTOs use `@IsString()` without an upper bound.** Today body-parser caps requests at 10kb, but per-field length isn't constrained, and several string fields drive expensive downstream operations (`humanToBaseUnits`, BigInt, queries).

## Evidence

### Issue 1: table/column interpolation

`src/core/database/database.service.ts:46-54`:
```typescript
async insert<T>(table: string, data: Record<string, unknown>): Promise<T> {
    const keys = Object.keys(data);
    const values = Object.values(data);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
    const columns = keys.join(", ");                                  // ⚠️ interpolated
    const text = `INSERT INTO ${table} (${columns}) VALUES (${placeholders}) RETURNING *`;
    //                          ^^^^^^^^  ^^^^^^^^^
    //                          unsafe   unsafe
    const rows = await this.query<T>(text, values);
    return rows[0];
}
```

Current callers (1):
- `src/auth/auth.service.ts:35` — `insert("deposit_wallets", { wallet_address, paired_wallet_address, paired_wallet_primary_key })`. Hardcoded table; key set is hardcoded. **Safe today.**

But the API contract is: any value goes. A future PR like…

```typescript
// future hypothetical
@Post(":table/import")
async import(@Param("table") table: string, @Body() data: Record<string, unknown>) {
    return this.db.insert(table, data);  // 💥
}
```

…lands a textbook SQL injection.

### Issue 2: DTO `IsString` without `MaxLength`

```bash
$ for f in src/*/dto/*.ts; do
    if grep -q "@IsString" "$f" && ! grep -q "MaxLength\|@Length" "$f"; then
        echo "$f"
    fi
  done

src/auth/dto/generate-access-codes.dto.ts
src/auth/dto/redeem-access-code.dto.ts
src/auth/dto/validate-wallet.dto.ts
src/deposit/dto/deposit.dto.ts
src/faucet/dto/faucet.dto.ts
src/orders/dto/create-order.dto.ts
src/orders/dto/update-order.dto.ts
src/portfolio/dto/portfolio.dto.ts
src/portfolio/dto/repay.dto.ts
src/withdraw/dto/withdraw.dto.ts
```

Notable hot spots:
- `RedeemAccessCodeDto.code` — hits a DB query per attempt; long string = slow query.
- `WithdrawRequestDto.amount`, `RepayRequestDto.amount`, `BaseCreateOrderDto.amount` — feed `humanToBaseUnits`, regex, BigInt construction. A 9-KB digit string still fits within a 10-KB body and forces O(n²) BigInt parsing.
- `GenerateAccessCodesDto.prefix` — concatenated into the generated code; an admin (or anyone with `ACCESS_CODE_ADMIN_SECRET`, see F-1) can inject huge prefixes.
- `UpdateNameDto.name` — already `@Length(1, 100)` ✅, used here as the reference example.

## Impact

- **F-17.1 (latent SQLi)**: easy for a junior dev to wire `databaseService.insert(req.params.x, req.body)` and create a critical CVE. The footgun is the API surface, not today's call sites.
- **F-17.2 (DoS by oversized strings)**: per-field 10-KB strings can trigger expensive parsing in `humanToBaseUnits` and force the regex `/^\d+(\.\d+)?$/` to scan thousands of characters per request. With F-2 (no rate limit) and 100 req/sec, this is a viable CPU saturation vector.
- **F-17.3 (logic bugs from giant prefixes)**: `GenerateAccessCodesDto.prefix` with a 9-KB value produces 9-KB access codes. Downstream UI, DB indexes, and exports may break.

## Recommended Solution

### 1. Make `DatabaseService.insert` safe by construction

**Option A — whitelist the schema in the service:**

```typescript
// src/core/database/database.service.ts
const ALLOWED_TABLES = new Set([
    "deposit_wallets",
    // add new tables explicitly as the codebase grows
] as const);

const TABLE_COLUMN_PATTERN = /^[a-z_][a-z0-9_]*$/;

async insert<T>(
    table: keyof typeof ALLOWED_TABLES extends string ? string : never,
    data: Record<string, unknown>,
): Promise<T> {
    if (!ALLOWED_TABLES.has(table as any)) {
        throw new Error(`Table ${table} is not allow-listed for insert()`);
    }
    const keys = Object.keys(data);
    for (const key of keys) {
        if (!TABLE_COLUMN_PATTERN.test(key)) {
            throw new Error(`Column name "${key}" is not a valid identifier`);
        }
    }
    const values = Object.values(data);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
    const columns = keys.join(", ");
    const text = `INSERT INTO ${table} (${columns}) VALUES (${placeholders}) RETURNING *`;
    const rows = await this.query<T>(text, values);
    return rows[0];
}
```

**Option B (preferred long term) — drop the generic helper, use repositories.** TypeORM already provides safe insert via the repository pattern; the project uses it (`accountRepository.findOne`, `Portfolio` queries, etc.). The two remaining raw callers (`auth.service.ts`, `chain-indexer.service.ts`) can use a typed repository instead. Consider deprecating `DatabaseService.insert` entirely after migration.

### 2. Default DTO string fields to bounded length

Add a project lint rule (Biome custom or eslint-plugin-class-validator) and patch the DTOs:

```typescript
// src/withdraw/dto/withdraw.dto.ts
import { IsNotEmpty, IsString, IsUUID, MaxLength } from "class-validator";
import { IsPositiveNumericString } from "../../common/validators/amount.validator";

export class WithdrawRequestDto {
    @IsUUID()
    assetId: string;

    @IsString()
    @IsNotEmpty()
    @MaxLength(30, { message: "Amount string too long" })
    @IsPositiveNumericString()
    amount: string;
}

// src/portfolio/dto/repay.dto.ts — same pattern
// src/orders/dto/create-order.dto.ts:
//   amount: @MaxLength(30)
//   assetId: already @IsUUID (no length needed)
//   marketIds: @ArrayMaxSize(20)  // also new
```

### 3. Rate-limit per field-length-bucket (advanced)

Combined with F-2 fixes, set a tighter throttler bucket on endpoints that take `amount`:

```typescript
@Throttle({ default: { limit: 30, ttl: 60000 } })  // 30/min/wallet
@UseGuards(WalletThrottlerGuard)
@Post()
async withdraw(...) { ... }
```

### 4. CI gate

Add a Semgrep rule to your CI:

```yaml
rules:
  - id: ts-template-string-in-sql
    pattern: |
      `INSERT INTO ${...} ...`
    message: "Do not interpolate identifiers into SQL. Use a whitelist or repository."
    languages: [typescript]
    severity: ERROR
```

## Verification

```bash
# Negative tests against DatabaseService.insert (in unit tests)
expect(() => db.insert("evil; DROP TABLE accounts;--", {})).toThrow();
expect(() => db.insert("deposit_wallets", { "drop table x": 1 })).toThrow();

# DTO bound enforcement
curl -X POST http://localhost:8080/withdraw \
  -H "Authorization: Bearer DEV_TOKEN_0x..." \
  -d "{\"assetId\":\"...\",\"amount\":\"$(printf '1%.0s' {1..40})\"}"
# Expected: 400 "Amount string too long"

# CI
semgrep --config=.semgrep.yml src/   # exits non-zero if rule fires
```

## References

- [OWASP: SQL Injection Prevention Cheat Sheet — Identifiers](https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html#defense-option-3-allow-list-input-validation)
- [class-validator: MaxLength](https://github.com/typestack/class-validator#validation-decorators)
- [CWE-89 Identifier injection variant](https://cwe.mitre.org/data/definitions/89.html)
