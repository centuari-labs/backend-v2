# F-21: Pagination DTOs accept unbounded `limit` and `page`

**Severity**: 🟡 Moderate (high without F-2 rate limiting)
**OWASP**: A04 Insecure Design, A05 Security Misconfiguration
**CWE**: CWE-770 (Allocation of Resources Without Limits or Throttling), CWE-20 (Improper Input Validation)

## Summary

Three portfolio query DTOs (`OrderHistoryQueryDto`, `OpenOrdersQueryDto`, `TransactionHistoryQueryDto`) coerce `?limit=…` and `?page=…` via `Number(value) || 10` with no upper bound. An authenticated user can request `?limit=10000000` or `?page=999999999`, forcing the DB to return millions of rows or compute astronomically deep `OFFSET` scans.

Combined with **F-2 (no global rate limiter)**, a single client can pin the server and the Postgres pool with a few requests.

## Evidence

`src/portfolio/dto/order-history.dto.ts`, `open-orders.dto.ts`, `transaction-history.dto.ts`:

```typescript
@IsOptional()
@Transform(({ value }) => Number(value) || 1)
page?: number = 1;

@IsOptional()
@Transform(({ value }) => Number(value) || 10)
limit?: number = 10;
```

No `@Min()`, no `@Max()`, no `@IsInt()`. The `Number(value) || N` idiom doesn't even reject `Infinity` (`Number("1e308")` is finite, `Number("1e400") = Infinity`, both pass).

These hit `PortfolioController` which is `@UseGuards(AuthGuard)` only — no per-wallet throttler.

## Impact

- **F-21.1 — Memory blow-up**: `?limit=1000000` on `/portfolio/order-history` forces the repository to materialize a 1M-row result set. With concurrent requests under F-2, the Node process OOMs.
- **F-21.2 — DB pool exhaustion**: long-running queries hold a connection from the `pg` pool. A handful of requests with extreme limits saturates the pool; legitimate users get 503s.
- **F-21.3 — Deep OFFSET scan**: `?page=10000000&limit=10` triggers `OFFSET 100000000` which Postgres must walk row-by-row. Per-request CPU cost grows linearly with `page`.
- **F-21.4 — Bandwidth amplification**: combined with F-14, 1M rows in JSON with stack-style error formatting can produce a multi-megabyte response.

## Reproduction

```bash
TOKEN=DEV_TOKEN_0x1111111111111111111111111111111111111111

# 1M-row request
time curl -s "http://localhost:8080/portfolio/order-history?limit=1000000" \
    -H "Authorization: Bearer $TOKEN" -o /dev/null
# Expect a long TTFB and a many-MB response

# Deep OFFSET
time curl -s "http://localhost:8080/portfolio/order-history?page=999999999&limit=10" \
    -H "Authorization: Bearer $TOKEN" -o /dev/null
# Expect ~seconds of CPU even on an empty table

# Pool exhaustion
for i in $(seq 1 50); do
    curl -s "http://localhost:8080/portfolio/transaction-history?limit=500000" \
        -H "Authorization: Bearer $TOKEN" -o /dev/null &
done
wait
# Concurrent legitimate requests during this window will see 503/timeouts.
```

## Recommended Solution

### 1. Bound `limit` and `page` in every paginated DTO

`src/portfolio/dto/order-history.dto.ts`:

```typescript
import { IsInt, IsOptional, Max, Min } from "class-validator";
import { Transform } from "class-transformer";

@IsOptional()
@Transform(({ value }) => {
    const n = Number(value);
    return Number.isInteger(n) && n >= 1 ? n : 1;
})
@IsInt()
@Min(1)
@Max(100_000, { message: "page must be ≤ 100000" })
page?: number = 1;

@IsOptional()
@Transform(({ value }) => {
    const n = Number(value);
    return Number.isInteger(n) && n >= 1 ? n : 10;
})
@IsInt()
@Min(1)
@Max(100, { message: "limit must be ≤ 100" })
limit?: number = 10;
```

Apply the same change to `OpenOrdersQueryDto` and `TransactionHistoryQueryDto`.

### 2. Centralize the bound

To prevent drift, factor a base class:

```typescript
// src/common/dto/pagination.dto.ts
import { IsInt, IsOptional, Max, Min } from "class-validator";
import { Transform } from "class-transformer";

const toPositiveInt = (fallback: number) => ({ value }: { value: unknown }) => {
    const n = Number(value);
    return Number.isInteger(n) && n >= 1 ? n : fallback;
};

export class PaginationQueryDto {
    @IsOptional()
    @Transform(toPositiveInt(1))
    @IsInt()
    @Min(1)
    @Max(100_000)
    page?: number = 1;

    @IsOptional()
    @Transform(toPositiveInt(10))
    @IsInt()
    @Min(1)
    @Max(100)
    limit?: number = 10;
}
```

Then:

```typescript
export class OrderHistoryQueryDto extends PaginationQueryDto {
    // existing fields, no page/limit duplication
}
```

### 3. Switch deep pagination to keyset (cursor) pagination

For `order-history`, `transaction-history`, and other tables that grow without bound, offset-based pagination is fundamentally fragile. Use a `created_at + id` cursor:

```typescript
@IsOptional()
@IsString()
@MaxLength(100)
cursor?: string;   // base64({ ts: ISO, id: UUID })
```

Repository:

```sql
SELECT * FROM orders
WHERE account_id = $1
  AND (created_at, id) < ($2::timestamptz, $3::uuid)
ORDER BY created_at DESC, id DESC
LIMIT $4;
```

This makes deep pagination O(1) and removes the OFFSET DoS vector entirely.

### 4. Defense in depth — query timeout

In `DatabaseService` / TypeORM connection options, set a statement timeout:

```typescript
this.pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    statement_timeout: 5_000,   // 5 seconds
    query_timeout: 5_000,
});
```

This guarantees no single query holds a pool connection for minutes.

### 5. Throttle per wallet on heavy endpoints

Once F-2 is fixed, attach a tighter throttler to the history endpoints:

```typescript
@Throttle({ default: { limit: 60, ttl: 60_000 } })  // 60/min/wallet
@UseGuards(WalletThrottlerGuard)
@Get("order-history")
```

## Verification

```bash
# After fix:
curl "http://localhost:8080/portfolio/order-history?limit=1000000" \
    -H "Authorization: Bearer $TOKEN"
# Expected: 400 "limit must be ≤ 100"

curl "http://localhost:8080/portfolio/order-history?page=999999999&limit=10" \
    -H "Authorization: Bearer $TOKEN"
# Expected: 400 "page must be ≤ 100000" — and even the largest valid page returns within the 5s statement timeout.
```

## References

- [OWASP API Security: API4 Unrestricted Resource Consumption](https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/)
- [Use The Index, Luke! — Paging through results (keyset)](https://use-the-index-luke.com/no-offset)
- [CWE-770](https://cwe.mitre.org/data/definitions/770.html)
