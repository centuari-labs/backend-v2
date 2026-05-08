# Security Findings — Centuari Backend v2

Pentest report from 2026-05-08. Web2 application-layer scope.

> **Start here**: [THREAT-MODEL.md](./THREAT-MODEL.md) traces 7 concrete attack chains across these findings and gives a 5–6-hour fix path that closes 6 of them.

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
| [F-23](./F-23-health-factor-floats.md) | 🔴 Critical | Health factor logic computed entirely in JS `Number` (floats) | Open |
| [F-24](./F-24-oracle-single-source.md) | 🔴 Critical | Single CoinGecko oracle, no sanity bounds, missing price → $0 | Open |
| [F-25](./F-25-cancel-vs-fill-race.md) | 🔴 Critical | `cancelOrder` runs without transaction/lock — races matching engine | Open |
| [F-26](./F-26-operator-key-blast-radius.md) | 🔴 Critical | Operator key signs every user action; bot keys derive from it | Open |
| [F-29](./F-29-no-balance-check-on-order.md) | 🔴 Critical | Order placement performs no balance check and never locks funds | Open |
| [F-32](./F-32-enable-dev-auth-not-prod-gated.md) | 🔴 Critical | `ENABLE_DEV_AUTH=true` not gated by `NODE_ENV` — accidental prod = total auth bypass | Open |
| [F-35](./F-35-paired-wallet-private-key-plaintext.md) | 🔴 Critical | Paired-wallet private keys generated server-side, persisted plaintext, returned over HTTP | Open |
| [F-3](./F-3-handlebars-cve.md) | 🟠 High | handlebars 4.7.8 — JS injection (transitive) | Open |
| [F-4](./F-4-jws-cve.md) | 🟠 High | jws 3.2.2 — improper HMAC verification | Open |
| [F-5](./F-5-multer-cve.md) | 🟠 High | multer 2.0.2 — DoS (3 CVEs) | Open |
| [F-6](./F-6-deposit-confirm-idor.md) | 🟠 High | `/deposit/confirm` accepts arbitrary txHash | Open |
| [F-17](./F-17-databaseservice-insert-and-dto-gaps.md) | 🟠 High | `DatabaseService.insert` table interpolation + DTO bound gaps | Open |
| [F-18](./F-18-nats-trust-boundary.md) | 🟠 High | NATS trust boundary — gateway accepts arbitrary publishers | Open |
| [F-20](./F-20-update-order-cross-asset-markets.md) | 🟠 High | `updateOrder` allows binding markets to a different asset | Open |
| [F-27](./F-27-repay-withdraw-toctou.md) | 🟠 High | `repay` and `withdrawLendPosition` not transactional — chain/DB desync | Open |
| [F-30](./F-30-access-granted-not-enforced.md) | 🟠 High | `access_granted` flag set on redemption but never enforced | Open |
| [F-34](./F-34-helmet-and-migrate-on-start.md) | 🟠 High | Missing security headers + auto-run migrations on every boot | Open |
| [F-38](./F-38-ws-orderbook-amplifier.md) | 🟠 High | WS `subscribe-orderbook` triggers expensive DB read per request | Open |
| [F-39](./F-39-bot-rates-no-market-anchor.md) | 🟠 High | Bot worker rates use `Math.random()` mid with no market anchor | Open |
| [F-41](./F-41-nats-payload-pii-exposure.md) | 🟠 High | NATS payloads expose `walletAddress` + amounts on a flat shared bus | Open |
| [F-43](./F-43-price-symbol-collision.md) | 🟠 High | `PriceService` ingests prices by `token.symbol` — duplicate symbols collide | Open |
| [F-10](./F-10-nestjs-core-cve.md) | 🟡 Moderate | `@nestjs/core` injection neutralization | Open |
| [F-11](./F-11-socketio-parser-cve.md) | 🟡 Moderate | `socket.io-parser` unbounded binary attachments | Open |
| [F-12](./F-12-body-parser-dos.md) | 🟡 Moderate | `body-parser` DoS on urlencoded | Open |
| [F-13](./F-13-admin-secret-timing.md) | 🟡 Moderate | `AdminSecretGuard` timing attack | Open |
| [F-14](./F-14-error-info-disclosure.md) | 🟡 Moderate | Error response leaks implementation details | Open |
| [F-21](./F-21-pagination-unbounded.md) | 🟡 Moderate | Pagination DTOs accept unbounded `limit` and `page` | Open |
| [F-22](./F-22-privy-console-error-leak.md) | 🟡 Moderate | `PrivyService.verify` uses `console.error` — token leak risk | Open |
| [F-28](./F-28-server-clock-maturity.md) | 🟡 Moderate | `withdrawLendPosition` gates maturity on server clock (not chain) | Open |
| [F-31](./F-31-recent-trades-cache-poisoning.md) | 🟡 Moderate | WS recent-trades cache poisonable + persists indefinitely | Open |
| [F-33](./F-33-dist-build-artifacts-committed.md) | 🟡 Moderate | Compiled `dist/` build artifacts committed to repo | Open |
| [F-36](./F-36-account-lookup-case-and-race.md) | 🟡 Moderate | `getOrCreateAccount` case-sensitive + race on duplicate insert | Open |
| [F-37](./F-37-privy-no-defense-in-depth.md) | 🟡 Moderate | Privy verification fully delegated to SDK; key file loaded but unused | Open |
| [F-40](./F-40-tokens-cache-no-invalidation.md) | 🟡 Moderate | `TokensService` cache has no invalidation — stale until restart | Open |
| [F-42](./F-42-chainconfig-public-operator-key.md) | 🟡 Moderate | `ChainConfigService.operatorPrivateKey` is a public readonly field | Open |
| [F-44](./F-44-coingecko-fetch-no-timeout.md) | 🟡 Moderate | `CoinGeckoProvider` calls `fetch` with no timeout — worker stalls | Open |

## Quick remediation priority

1. **F-1** — `.gitignore` the `.env` file, rotate all keys (10 min)
2. **F-2** — Wire global `ThrottlerGuard` via `APP_GUARD` (10 min)
3. **F-7** — Add auth + rate limit to `/faucet/request-tokens` (20 min)
4. **F-9** — Switch `redeemAccessCode` to atomic UPDATE (20 min)
5. **F-15** — Auth WS handshake + server-derived room names (45 min)
6. **F-16** — Migrate withdraw/repay/order-worker to BigInt (1–2 h)
7. **F-19** — Wait for finality + reorg-aware reconciliation (2–4 h)
8. **F-20** — Validate market ↔ asset on order create/update (30 min)
9. **F-23** — Migrate health factor to BigInt fixed-point (3–5 h)
10. **F-24** — Strict missing-price handling + sanity bounds + readiness guard (2–3 h)
11. **F-25** — Wrap `cancelOrder` in tx + `FOR UPDATE`; transactional outbox for NATS (1–2 h)
12. **F-26** — Split operator key by role; move bot seed to its own key; KMS/HSM (4–8 h, plus contract changes)
13. **F-27** — Wrap `repay`/`withdrawLendPosition` in tx; outbox for chain calls; idempotency keys (4–6 h)
14. **F-3..F-5, F-10** — Run `pnpm update` to clear transitive CVEs (5 min)
15. **F-6** — Verify txHash is associated with the caller's wallet (30 min)
16. **F-17** — Allow-list table names in `DatabaseService.insert`; add `MaxLength` to DTOs (30 min)
17. **F-18** — Enable NATS auth + bind to localhost in dev (1 h)
18. **F-21** — Cap `limit`/`page` in pagination DTOs; statement_timeout (15 min)
19. **F-14** — Strip stack traces from error responses (10 min)
20. **F-22** — Replace `console.error` in PrivyService with Logger (5 min)
21. **F-28** — Use chain `block.timestamp` for maturity checks (30 min)
22. **F-29** — Lock `portfolio.locked_amount` on order create; symmetric release on cancel/fill (3–5 h)
23. **F-30** — Add `AccessGrantedGuard` (or remove the system) (1 h)
24. **F-31** — Validate NATS shapes + DB cross-check for recent-trades cache (1 h)
25. **F-32** — Fail-closed boot guard for `ENABLE_DEV_AUTH` + `NODE_ENV` (15 min)
26. **F-33** — `git rm -r --cached dist/`; CI guard against tracked build output (15 min)
27. **F-34** — Add helmet; gate `MIGRATIONS_ON_START`/`SEED_ON_START` by env; advisory lock (1–2 h)
28. **F-35** — Eliminate server-side keygen OR encrypt at rest + auth + drop key from response (4–6 h)
29. **F-36** — Lowercase wallet at strategy ingress; upsert in `getOrCreateAccount`; DB CHECK + index (1 h)
30. **F-37** — Add `jose.jwtVerify` defense-in-depth; mandatory `PRIVY_ISSUER`/`PRIVY_APP_ID`; per-route freshness (1–2 h)
31. **F-38** — UUID-validate `assetId`; per-IP throttle on `subscribe-orderbook`; load-TTL cache (1 h)
32. **F-39** — Anchor bot mid to on-chain APR / VWAP; `crypto.randomInt`; loss budget; exclude bots from bestRate (3–4 h)
33. **F-40** — `@Interval` cache refresh; LISTEN/NOTIFY hook; immutable-decimals trigger (1–2 h)
34. **F-41** — Drop `walletAddress` from NATS payloads; per-account subjects; NATS TLS (3–4 h)
35. **F-42** — Private-field `operatorPrivateKey`; signer accessor; `toJSON` redaction; CI lint rule (1–2 h)
36. **F-43** — Key price ingestion by `token.id`, not `symbol`; per-chain symbol/coingecko_id unique indexes (2–3 h)
37. **F-44** — `AbortSignal.timeout` on CoinGecko fetch; in-flight guard on the worker; honour `Retry-After` (30 min)

Total ~50–72 hours to address all critical and high findings.

## Out of scope (functional bugs, not security)

- `/auth/validate` — `import type` strips runtime metadata, validation rejects all inputs.
- `auth.service.validateAndCreateDepositWallet` references the non-existent `deposit_wallets` table.
- `IsUUID()` in `create-order.dto.ts` rejects custom UUID variants — order endpoints are functionally broken for current markets.

## Methodology

- **Passive**: gitleaks (38 secrets), pnpm audit (57 advisories), semgrep auto-config.
- **Active**: dev-token spoofing, IDOR sweep, race condition test (10 concurrent), header injection.
- **Code review**: ownership checks in services, query parameterization, crypto usage.
