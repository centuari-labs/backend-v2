---
title: "fix: Rate Limit Audit Implementation"
type: fix
status: active
date: 2026-06-05
---

# Rate Limit Audit — Implementation Plan

## Context

A deep audit of backend-v2's rate-limiting posture (June 2026) identified
that the `ThrottlerModule.forRoot([short, long])` config registered in
`AppModule` since day one was **dead code** — no `APP_GUARD` provider
attached the `ThrottlerGuard` globally. The only controller actually
protected was `OrdersController` via class-level `@UseGuards`. Roughly
**85% of HTTP endpoints had zero rate limiting**, including paths that
submit on-chain transactions with the operator key (drain-the-operator
scenario). A custom Redis-backed limiter exists but only covers two
`/collateral/*` endpoints, has an atomicity race between `INCR` and
`EXPIRE`, and has zero unit-test coverage.

This document tracks the implementation plan for closing every gap
surfaced by the audit, organised by the original priority labels
(P0–P3). Faucet HTTP endpoint is explicitly **out of scope** for now
per product instruction (the order-worker bot relies on its drip
cadence and any throttle would interfere).

## Status snapshot

| Priority | Item | Status | Landed via |
|---|---|---|---|
| P0 #1 | Throttle `/faucet/request-tokens` | ✅ Done | upstream `978e577` (1/1s + 5/60s sudah terpasang; bot order-worker tidak terdampak — memanggil `FaucetService` in-process, bukan HTTP) |
| P0 #2 | Throttle `/withdraw` | ✅ Done | upstream `978e577` |
| P0 #2 | Throttle `/portfolio/repay` + `/portfolio/withdraw-lend-position` | ✅ Done | PR-1 revisi (`docs/claude/plans/2026-06-11-001-fix-rate-limit-wallet-tracker-plan.md`) |
| P0 #3 | Register `WalletThrottlerGuard` as `APP_GUARD` | ✅ Done | PR #114 |
| P0 #3a | Drop route-level `@UseGuards(WalletThrottlerGuard)` on `/auth/redeem-access-code` — SAH hanya SETELAH tracker fix (lihat catatan PR-1 di bawah; premis "double-throttle bug" semula keliru) | ✅ Done | PR-1 revisi (idem) |
| P1 #4 | `app.set('trust proxy', N)` in `main.ts` | 🚨 Open | PR-2 |
| P1 #5 | Atomic Redis `INCR + EXPIRE` (Lua or pipeline) | 🚨 Open | PR-2 |
| P1 #6 | WebSocket subscribe rate limit + DTO validation | 🚨 Open | PR-3 |
| P2 #7 | Split throttle budget — place vs cancel/update in `OrdersController` | 🚨 Open | PR-4 |
| P2 #8 | Split Redis budget — collateral flag vs unflag | 🚨 Open | PR-4 |
| P2 #11 | Loosen throttle for portfolio read endpoints | 🚨 Open | PR-4 |
| P3 #12 | Composite tracker `walletAddress + privyUserId` | 🚨 Open | PR-5 |
| P3 #13 | Distributed throttler storage (Redis-backed) | 🚨 Open | PR-5 |
| P3 #14 | Metrics — `rate_limit_hit_total{route, tracker_type}` | 🚨 Open | PR-6 |
| P3 #15 | Unit tests for `RedisRateLimiterService` | 🚨 Open | PR-2 |
| P3 #16 | Fail-open vs fail-closed policy + documentation | 🚨 Open | PR-6 |

Out-of-scope (audit-adjacent but not strictly rate-limit; tracked
separately elsewhere): caching of portfolio reads, `?days` upper-bound
validation in `ChartDataQueryDto`.

## Working agreements

Every PR in this plan follows the same hygiene rules:

1. Branch from the **latest `staging`** at the time of PR creation;
   resolve any merge conflict locally with `git merge` (no rebase, no
   force push).
2. **Small, atomic commits** — one commit per logically independent
   change; each commit alone must leave the tree green.
3. `pnpm run lint` (Biome), `pnpm run test` (unit), and `pnpm run
   test:integration` must all be green **before push**.
4. **No `gh pr merge`** — the maintainer merges via the GitHub UI.
5. **No `--force` / `--force-with-lease`** on shared branches.
6. PR body must include: Summary, What / Why, Test Plan checklist,
   Rollout notes, Out-of-scope.

## Threshold convention

Established by upstream `978e577` and PR #114; reused throughout this
plan unless noted.

| Endpoint class | `short` | `long` |
|---|---|---|
| On-chain operator paths (`/withdraw`, `/portfolio/repay`, `/portfolio/withdraw-lend-position`) | 1 / 1s | 5 / 60s |
| Auth login (`/auth/login`) | 3 / 1s | 20 / 60s |
| Admin (`/auth/access-codes/*`) | 1 / 1s | 10 / 60s |
| Default `APP_GUARD` | 5 / 1s | 60 / 60s |
| Portfolio read endpoints (`GET /portfolio/*`) — looser, FE polling | 10 / 1s | 200 / 60s |
| Order cancel/update (looser than place) | 10 / 1s | 120 / 60s |
| WebSocket subscribe per `client.id` | n/a | 10 / 60s |
| Collateral flag (cheap enqueue) | n/a | 50 / 24h |
| Collateral unflag (expensive on-chain) | n/a | 5 / 24h |

---

## PR-1 — DIREVISI → `fix/rate-limit-wallet-tracker` (P0 #2 + P0 #3a + tracker fix)

> **Koreksi premis (2026-06-11).** Review menemukan bahwa per-wallet
> tracking TIDAK PERNAH berfungsi: `WalletThrottlerGuard` sebagai
> `APP_GUARD` berjalan sebelum `AuthGuard` level-route, sehingga
> `req.user` selalu kosong saat `getTracker()` dievaluasi dan semua
> throttle efektif per-IP. Guard ganda di `/auth/redeem-access-code`
> BUKAN "double-throttle bug" — saat itu justru satu-satunya konfigurasi
> per-wallet yang bekerja. Menghapusnya baru sah SETELAH tracker fix
> landing. Rencana lengkap pengganti seksi ini:
> `docs/claude/plans/2026-06-11-001-fix-rate-limit-wallet-tracker-plan.md`
> (resolver verifikasi dua tahap + throttle on-chain + pembersihan guard).
> Deskripsi di bawah dipertahankan sebagai arsip premis lama.

**Goal (lama, premis dikoreksi di atas)**: close the last two P0
correctness gaps — operator-drain windows on `/portfolio/repay` and
`/portfolio/withdraw-lend-position`, and the (mischaracterized)
double-throttle on `/auth/redeem-access-code`.

### Files

| File | Change |
|---|---|
| `src/portfolio/portfolio.controller.ts` | `@Throttle({ short: { ttl: 1000, limit: 1 }, long: { ttl: 60_000, limit: 5 } })` on `repay()` and `withdrawLendPosition()` |
| `src/auth/auth.controller.ts:41` | Strip `WalletThrottlerGuard` from `@UseGuards(AuthGuard, WalletThrottlerGuard)` on `redeemAccessCode` — APP_GUARD already covers it globally; leaving it doubles the counter |
| (audit sweep) | `grep -rn "WalletThrottlerGuard" src/` — drop any other `@UseGuards` references introduced before APP_GUARD landed |

### Commits

1. `fix(portfolio): tight throttle on-chain repay & withdraw-lend-position`
2. `fix(auth): drop redundant WalletThrottlerGuard from redeem-access-code`
3. (conditional) `chore: audit-sweep redundant WalletThrottlerGuard @UseGuards`

### Tests

- Existing unit + integration suites must stay green; the throttle
  decorator does not affect business logic the tests assert on.
- Manual sanity (documented in PR body, not automated): 2× `repay`
  within 1 s from the same wallet should return `429`.

### Dependencies

None. Ready to start immediately after PR #114 merges to `staging`.

### Risk

🟢 **Low**. Restrictive only; reversible by removing the decorator if
the threshold turns out to be too tight.

---

## PR-2 — `chore/trust-proxy-and-redis-atomic-limiter` (P1 #4 + P1 #5 + P3 #15)

**Goal**: fix the per-IP tracker behind a reverse proxy and close the
race window in the custom Redis limiter. Bundled with the long-missing
unit tests because all three changes touch the same domain (per-IP
tracking + Redis storage).

### Files

| File | Change |
|---|---|
| `src/main.ts` | `app.set('trust proxy', 1)` — single hop assumed (confirm in PR-2 questionnaire); document the chosen value with a comment |
| `src/common/rate-limit/redis-rate-limiter.service.ts` | Refactor `consume()` to atomic: either an ioredis pipeline `multi().incr(key).expire(key, ttl, "NX").exec()` or a Lua script. Preserve the existing return shape (`{ allowed, remaining, retryAfterSeconds }`) |
| `src/__test__/common/rate-limit/redis-rate-limiter.service.test.ts` | **New.** Cases: (a) first call sets TTL — assert via `client.ttl(key) > 0`; (b) two concurrent calls produce monotonic counters; (c) TTL expiry resets the counter; (d) `allowed=false` once `limit` exceeded; (e) `retryAfterSeconds` falls back to `windowSeconds` on `TTL = -1` |
| `src/__test__/integration/collateral-rate-limit.integration.test.ts` | **Optional.** End-to-end: spam `POST /collateral/flag` 11× over a 24 h window — 11th must respond `429` with `retryAfterSeconds` in the body |

### Commits

1. `chore(infra): set trust proxy = 1 for accurate per-IP throttling behind reverse proxy`
2. `fix(rate-limit): make Redis INCR+EXPIRE atomic via pipeline`
3. `test(rate-limit): cover RedisRateLimiterService consume()`

### Tests

- New unit tests in (c) above. Use `ioredis-mock` (add as `devDependency`
  if not present; check `pnpm-lock.yaml` before installing).
- Existing collateral integration test must stay green.

### Dependencies

- Not strictly blocked, but should land **after PR-1** to keep merge
  conflicts on `app.module.ts` predictable.

### Risk

🟡 **Medium**. Misconfigured `trust proxy` (e.g. setting `1` when there
are two hops — CDN → ALB → backend) makes `req.ip` resolve to the CDN
edge IP, collapsing every user behind a single shared counter.
Mitigation: pre-PR check with the platform owner; add a brief debug log
of `req.ip` in dev mode for the first 24 h after deploy.

---

## PR-3 — `feat/websocket-rate-limit` (P1 #6)

**Goal**: WebSocket subscribe-event rate limit + manual DTO validation.
The global `ValidationPipe` does not attach to gateways, so payload
validation needs to be explicit inside each handler.

### Files

| File | Change |
|---|---|
| `src/core/websocket/websocket.gateway.ts` | Per-`client.id` subscribe counter: in-memory `Map<string, { count: number; resetAt: number }>` with a 60 s reset window and a cleanup tick on the existing `cleanupInterval`. Reject `subscribe-orderbook` / `subscribe-recent-trades` / `subscribe-prices` once `count >= 10` in the active window. Manual `body.assetId` UUID regex check at the top of each handler — emit an `error` event and `return` early on mismatch |
| `@WebSocketGateway` options | Add `pingTimeout: 20_000`, `pingInterval: 25_000`, `maxHttpBufferSize: 1_000_000` (1 MB) to bound idle/payload size |
| `src/__test__/core/websocket/websocket.gateway.test.ts` | Add tests: 11th subscribe in a window rejects with `error` event; invalid `assetId` rejects without DB hit |

### Commits

1. `feat(ws): rate-limit subscribe events per client`
2. `feat(ws): validate assetId in subscribe handlers`
3. `chore(ws): tighten gateway connection options`

### Tests

- Extend existing `websocket.gateway.test.ts` and
  `websocket-recent-trades.integration.test.ts` with the new flows.

### Dependencies

- None. Can run in parallel with PR-2.

### Risk

🟡 **Medium**. A subscribe-rate threshold tuned too low will break the
frontend's reconnect-storm behaviour (e.g. when the user toggles tabs
or the LB cycles). Confirm `10 / 60s` per `client.id` with the FE team
before shipping; loosen if needed.

---

## PR-4 — `chore/throttle-tuning` (P2 #7 + P2 #8 + P2 #11)

**Goal**: tune per-endpoint budgets so cost / risk asymmetry is
reflected in the throttle config. Grouped because all three are small
`@Throttle` overrides or Redis-key splits with no shared logic.

### Files

| File | Change |
|---|---|
| `src/orders/orders.controller.ts` | Keep class-level default at `5 / 1s + 60 / 60s` (place orders). Add per-route `@Throttle({ short: { ttl: 1000, limit: 10 }, long: { ttl: 60_000, limit: 120 } })` to `cancelOrder` and `updateOrder` (looser; mass-cancel during a liquidation event must not lock the wallet out of placing rescue orders) |
| `src/collateral/collateral.service.ts` + `src/collateral/constants.ts` | Replace single `collateral:write:${wallet}` key with `collateral:flag:${wallet}` (budget 50 / 24h, cheap enqueue) and `collateral:unflag:${wallet}` (budget 5 / 24h, expensive on-chain). Update `consumeRateLimit()` to take a `bucket: "flag" \| "unflag"` argument |
| `src/portfolio/portfolio.controller.ts` | Class-level `@Throttle({ short: { ttl: 1000, limit: 10 }, long: { ttl: 60_000, limit: 200 } })` on the read endpoints (everything except `withdrawLendPosition` and `repay`, which keep their tight PR-1 budgets). Allows FE to poll `my-portfolio` / `user-details` ~1 Hz without 429-ing |

### Commits

1. `chore(orders): split throttle budget for cancel/update vs place`
2. `chore(collateral): split flag (50/24h) vs unflag (5/24h) budgets`
3. `chore(portfolio): loosen read endpoint throttle for FE polling`

### Tests

- Existing tests stay green (limits are numeric configuration, not
  business logic).
- Document the polling cadence change in the PR body.

### Dependencies

- Not strict, but **should land after PR-2** (atomic Redis) — the
  collateral split-key change relies on the same `consume()` primitive
  and we want it race-free.

### Risk

🟢 **Low**. Numeric configuration, reversible.

---

## PR-5 — `feat/throttle-account-tracker-redis-storage` (P3 #12 + P3 #13)

**Goal**: cross-cutting throttler infra upgrade — composite tracker
+ Redis-backed storage so horizontal scaling does not multiply the
effective budget by pod count.

### Files

| File | Change |
|---|---|
| `src/common/guards/wallet-throttler.guard.ts` | `getTracker()` returns composite: `${walletAddress}:${privyUserId}` once `AuthGuard` has populated `req.user`; fall back to `req.ip` only when both are missing. Same Privy user with multiple linked wallets no longer multiplies the budget |
| `package.json` | Add `@nest-lab/throttler-storage-redis` (verify license + maintenance status; consider in-house implementation if abandoned) |
| `src/app.module.ts` | `ThrottlerModule.forRootAsync({ inject: [RedisService], useFactory: (redis) => ({ throttlers: [...], storage: new ThrottlerStorageRedisService(redis.getClient()) }) })`. Gate storage selection behind `THROTTLER_STORAGE=memory \| redis` env var (default `redis` in prod, `memory` in dev/test) |
| `src/__test__/common/guards/wallet-throttler.guard.test.ts` | **New.** Tracker resolution under three scenarios: (a) authenticated wallet, (b) authenticated wallet without `privyUserId`, (c) unauthenticated → `req.ip` |

### Commits

1. `feat(throttler): composite tracker walletAddress+privyUserId`
2. `feat(throttler): use Redis-backed storage for horizontal scale`
3. `test(throttler): cover WalletThrottlerGuard tracker resolution`

### Tests

- New unit tests in (4) above.
- Integration: if the test infra can spin up two NestJS instances
  sharing one Redis, assert counter is shared.

### Dependencies

- **Blocked by PR-2.** Atomic `consume()` must land first; otherwise
  Redis storage inherits the same race.

### Risk

🟠 **High**. Changing throttler storage is a stateful behaviour change;
a broken Redis storage adapter will fail-open and silently disable
throttling. Mitigations: env-var feature flag, deploy to staging first,
verify hit counters via PR-6 metrics.

---

## PR-6 — `feat/throttle-observability-and-policy` (P3 #14 + P3 #16)

**Goal**: make throttle behaviour observable and document the
fail-open vs fail-closed policy for Redis outages.

### Files

| File | Change |
|---|---|
| `src/common/guards/wallet-throttler.guard.ts` | Override `throwThrottlingException()` to increment `rate_limit_hit_total{route, tracker_type}` before throwing. Labels: `route` = the matched route path, `tracker_type` = `wallet` / `ip` |
| `src/common/rate-limit/redis-rate-limiter.service.ts` | Wrap `client.incr()` in try/catch keyed by `RATE_LIMIT_FAILOPEN` env (default `false` → fail-closed → throw 500). When `true`, log a `warn` and return `{ allowed: true, remaining: -1 }` |
| (new) `/metrics` endpoint | If `prom-client` (or whatever metric stack the team uses) is not yet wired, add it. Endpoint must be `@SkipThrottle()` and ideally guarded by an internal-network IP allowlist |
| `docs/rate-limit.md` (new) | Tracker semantics, full throttle table, fail-open policy decision, observability runbook (dashboard URLs, alert thresholds) |

### Commits

1. `feat(metrics): expose rate_limit_hit_total counter`
2. `feat(rate-limit): RATE_LIMIT_FAILOPEN env gate when Redis is unhealthy`
3. `docs(rate-limit): policy + observability runbook`

### Tests

- Unit: increment metric on throttle hit; fail-open path returns
  `allowed: true` when Redis throws.

### Dependencies

- **Blocked by PR-2 + PR-5**. Observability presumes the final
  storage shape and atomic primitive are in place.

### Risk

🟡 **Medium**. Depends on whether the project already has a metric
backend (Prometheus, Datadog, OTLP). If not, the `/metrics` endpoint is
introduced here for the first time — confirm with infra owner first.

---

## Dependency graph

```
PR-1 (P0 cleanup)
   ↓
PR-2 (trust proxy + atomic Redis + tests)
   ↓                       ↘
PR-3 (WS rate limit)         PR-4 (throttle tuning)
                              ↓
                             PR-5 (account tracker + Redis storage)
                              ↓
                             PR-6 (metrics + policy)
```

- **Critical path**: PR-1 → PR-2 → PR-5 → PR-6 (4 review cycles).
- **Parallel**: PR-3 can land any time after PR-1.
- **Estimate**: 6 PRs, ~18–22 commits total.

## Open questions for the maintainer

1. **PR-1 scope** — limit to the two named endpoints, or sweep every
   remaining `@UseGuards(WalletThrottlerGuard)` after the APP_GUARD
   change in PR #114?
2. **Threshold values** in the convention table — accept as-is, or
   tune any of them before shipping?
3. **`trust proxy` value** for PR-2 — is the deployment behind one
   hop (just an ALB) or two (CDN → ALB)? The right value is
   `<number-of-trusted-hops>`.
4. **Redis instance** for PR-5 — staging shares the same Redis as the
   collateral limiter (`REDIS_URL`)?
5. **Metric backend** for PR-6 — is there an existing Prometheus /
   Datadog / OTLP setup, or does this PR introduce `prom-client` for
   the first time?

## Out of scope (tracked separately, not in this plan)

- Caching of portfolio read endpoints (`my-portfolio`, `user-details`,
  `lend-borrow-assets`) — separate performance audit.
- `?days` upper-bound validation in `ChartDataQueryDto` — input
  validation audit.
- Faucet throttle — deferred per product instruction (bot drip
  cadence).

## References

- PR #114 — `feat(throttler): enforce global rate limiting via APP_GUARD`
- Upstream commit `978e577` — `fix(security): remediate backend-v2
  audit findings (C1, H1-H5, M1-M7)` (landed `/auth/validate` removal,
  tight throttle on `/withdraw`, `/auth/login`, `/deposit/confirm`)
- `src/common/guards/wallet-throttler.guard.ts` — current tracker
  implementation
- `src/common/rate-limit/redis-rate-limiter.service.ts` — current
  Redis primitive
