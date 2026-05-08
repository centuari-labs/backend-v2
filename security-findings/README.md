# Security Findings — Centuari Backend v2

Pentest report from 2026-05-08. Web2 application-layer scope.

## Index

| ID | Severity | Title | Status |
|----|----------|-------|--------|
| [F-1](./F-1-secrets-committed.md) | 🔴 Critical | Secrets committed to repo (`.env`) | Open |
| [F-2](./F-2-no-global-rate-limiter.md) | 🔴 Critical | No global rate limiter | Open |
| [F-7](./F-7-faucet-no-auth.md) | 🔴 Critical | `/faucet/request-tokens` has no auth (drains operator) | Open |
| [F-9](./F-9-access-code-race.md) | 🔴 Critical | Race condition on access code redemption | Open |
| [F-3](./F-3-handlebars-cve.md) | 🟠 High | handlebars 4.7.8 — JS injection (transitive) | Open |
| [F-4](./F-4-jws-cve.md) | 🟠 High | jws 3.2.2 — improper HMAC verification | Open |
| [F-5](./F-5-multer-cve.md) | 🟠 High | multer 2.0.2 — DoS (3 CVEs) | Open |
| [F-6](./F-6-deposit-confirm-idor.md) | 🟠 High | `/deposit/confirm` accepts arbitrary txHash | Open |
| [F-10](./F-10-nestjs-core-cve.md) | 🟡 Moderate | `@nestjs/core` injection neutralization | Open |
| [F-11](./F-11-socketio-parser-cve.md) | 🟡 Moderate | `socket.io-parser` unbounded binary attachments | Open |
| [F-12](./F-12-body-parser-dos.md) | 🟡 Moderate | `body-parser` DoS on urlencoded | Open |
| [F-13](./F-13-admin-secret-timing.md) | 🟡 Moderate | `AdminSecretGuard` timing attack | Open |
| [F-14](./F-14-error-info-disclosure.md) | 🟡 Moderate | Error response leaks implementation details | Open |

## Quick remediation priority

1. **F-1** — `.gitignore` the `.env` file, rotate all keys (10 min)
2. **F-2** — Wire global `ThrottlerGuard` via `APP_GUARD` (10 min)
3. **F-7** — Add auth + rate limit to `/faucet/request-tokens` (20 min)
4. **F-9** — Switch `redeemAccessCode` to atomic UPDATE (20 min)
5. **F-3..F-5, F-10** — Run `pnpm update` to clear transitive CVEs (5 min)
6. **F-6** — Verify txHash is associated with the caller's wallet (30 min)
7. **F-14** — Strip stack traces from error responses (10 min)

Total ~1.5 hours to address all critical and high findings.

## Out of scope (functional bugs, not security)

- `/auth/validate` — `import type` strips runtime metadata, validation rejects all inputs.
- `auth.service.validateAndCreateDepositWallet` references the non-existent `deposit_wallets` table.
- `IsUUID()` in `create-order.dto.ts` rejects custom UUID variants — order endpoints are functionally broken for current markets.

## Methodology

- **Passive**: gitleaks (38 secrets), pnpm audit (57 advisories), semgrep auto-config.
- **Active**: dev-token spoofing, IDOR sweep, race condition test (10 concurrent), header injection.
- **Code review**: ownership checks in services, query parameterization, crypto usage.
