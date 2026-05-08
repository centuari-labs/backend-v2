# Security Findings — Centuari Backend v2

Pentest report from 2026-05-08. Web2 application-layer scope.

## Index

| ID | Severity | Title | Status |
|----|----------|-------|--------|
| [F-1](./F-1-secrets-committed.md) | 🔴 Critical | Secrets committed to repo (`.env`) | Open |
| [F-2](./F-2-no-global-rate-limiter.md) | 🔴 Critical | No global rate limiter | Open |
| [F-7](./F-7-faucet-no-auth.md) | 🔴 Critical | `/faucet/request-tokens` has no auth (drains operator) | Open |
| [F-9](./F-9-access-code-race.md) | 🔴 Critical | Race condition on access code redemption | Open |
| [F-15](./F-15-websocket-no-auth.md) | 🔴 Critical | WebSocket has no auth — cross-user data leak | Open |
| [F-16](./F-16-money-precision-loss.md) | 🔴 Critical | Token amounts use JS `Number` — precision loss on money paths | Open |
| [F-19](./F-19-chain-indexer-no-finality.md) | 🔴 Critical | Chain indexer credits deposits without finality / reorg handling | Open |
| [F-3](./F-3-handlebars-cve.md) | 🟠 High | handlebars 4.7.8 — JS injection (transitive) | Open |
| [F-4](./F-4-jws-cve.md) | 🟠 High | jws 3.2.2 — improper HMAC verification | Open |
| [F-5](./F-5-multer-cve.md) | 🟠 High | multer 2.0.2 — DoS (3 CVEs) | Open |
| [F-6](./F-6-deposit-confirm-idor.md) | 🟠 High | `/deposit/confirm` accepts arbitrary txHash | Open |
| [F-17](./F-17-databaseservice-insert-and-dto-gaps.md) | 🟠 High | `DatabaseService.insert` table interpolation + DTO bound gaps | Open |
| [F-18](./F-18-nats-trust-boundary.md) | 🟠 High | NATS trust boundary — gateway accepts arbitrary publishers | Open |
| [F-20](./F-20-update-order-cross-asset-markets.md) | 🟠 High | `updateOrder` allows binding markets to a different asset | Open |
| [F-10](./F-10-nestjs-core-cve.md) | 🟡 Moderate | `@nestjs/core` injection neutralization | Open |
| [F-11](./F-11-socketio-parser-cve.md) | 🟡 Moderate | `socket.io-parser` unbounded binary attachments | Open |
| [F-12](./F-12-body-parser-dos.md) | 🟡 Moderate | `body-parser` DoS on urlencoded | Open |
| [F-13](./F-13-admin-secret-timing.md) | 🟡 Moderate | `AdminSecretGuard` timing attack | Open |
| [F-14](./F-14-error-info-disclosure.md) | 🟡 Moderate | Error response leaks implementation details | Open |
| [F-21](./F-21-pagination-unbounded.md) | 🟡 Moderate | Pagination DTOs accept unbounded `limit` and `page` | Open |
| [F-22](./F-22-privy-console-error-leak.md) | 🟡 Moderate | `PrivyService.verify` uses `console.error` — token leak risk | Open |

## Quick remediation priority

1. **F-1** — `.gitignore` the `.env` file, rotate all keys (10 min)
2. **F-2** — Wire global `ThrottlerGuard` via `APP_GUARD` (10 min)
3. **F-7** — Add auth + rate limit to `/faucet/request-tokens` (20 min)
4. **F-9** — Switch `redeemAccessCode` to atomic UPDATE (20 min)
5. **F-15** — Auth WS handshake + server-derived room names (45 min)
6. **F-16** — Migrate withdraw/repay/order-worker to BigInt (1–2 h)
7. **F-19** — Wait for finality + reorg-aware reconciliation (2–4 h)
8. **F-20** — Validate market ↔ asset on order create/update (30 min)
9. **F-3..F-5, F-10** — Run `pnpm update` to clear transitive CVEs (5 min)
10. **F-6** — Verify txHash is associated with the caller's wallet (30 min)
11. **F-17** — Allow-list table names in `DatabaseService.insert`; add `MaxLength` to DTOs (30 min)
12. **F-18** — Enable NATS auth + bind to localhost in dev (1 h)
13. **F-21** — Cap `limit`/`page` in pagination DTOs; statement_timeout (15 min)
14. **F-14** — Strip stack traces from error responses (10 min)
15. **F-22** — Replace `console.error` in PrivyService with Logger (5 min)

Total ~8–10 hours to address all critical and high findings.

## Out of scope (functional bugs, not security)

- `/auth/validate` — `import type` strips runtime metadata, validation rejects all inputs.
- `auth.service.validateAndCreateDepositWallet` references the non-existent `deposit_wallets` table.
- `IsUUID()` in `create-order.dto.ts` rejects custom UUID variants — order endpoints are functionally broken for current markets.

## Methodology

- **Passive**: gitleaks (38 secrets), pnpm audit (57 advisories), semgrep auto-config.
- **Active**: dev-token spoofing, IDOR sweep, race condition test (10 concurrent), header injection.
- **Code review**: ownership checks in services, query parameterization, crypto usage.
