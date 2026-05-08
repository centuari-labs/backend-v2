# Pentest 2026-05-08 — 47 findings tracking

Tracking epic for the web2-scope pentest performed on 2026-05-08. Findings live on branch [`security/pentest-findings-2026-05-08`](https://github.com/centuari-labs/backend-v2/tree/security/pentest-findings-2026-05-08/security-findings) under `security-findings/`.

**Numbers**: 47 findings — 15 critical, 16 high, 16 moderate.

> Read [`THREAT-MODEL.md`](https://github.com/centuari-labs/backend-v2/blob/security/pentest-findings-2026-05-08/security-findings/THREAT-MODEL.md) first — it traces 7 concrete attack chains across these findings and shows which fixes close the most chains per hour invested.

---

## TL;DR fix path

The 8 actions below close 6 of the 7 attack chains in ~5–6 hours of code work:

1. <TBD-F-32> — fail-closed boot guard for `ENABLE_DEV_AUTH` (~15 min)
2. <TBD-F-2> — wire global `ThrottlerGuard` via `APP_GUARD` (~10 min)
3. <TBD-F-15> — auth WS handshake + server-derived rooms (~45 min)
4. <TBD-F-7> — auth + per-wallet daily quota on `/faucet/request-tokens` (~20 min)
5. <TBD-F-30> — add `AccessGrantedGuard` (or remove the system) (~1 h)
6. <TBD-F-1> — rotate keys, scrub git history, untrack `.env` (~1 h)
7. <TBD-F-25> — wrap `cancelOrder` in tx + `FOR UPDATE` (~1–2 h)
8. <TBD-F-18> — NATS auth + bind to localhost (~1 h)

The remaining "free money" attack chain (reorg / float drift) needs ~14–25 h of follow-up:

- <TBD-F-19> — chain indexer waits for finality + reorg compensation (~2–4 h)
- <TBD-F-23> — health-factor BigInt fixed-point migration (~3–5 h)
- <TBD-F-24> — strict missing-price + sanity bounds + readiness guard (~2–3 h)
- <TBD-F-26> — operator-key role separation / KMS signing (~4–8 h)
- <TBD-F-29> — order-placement balance lock (~3–5 h)

---

## Children — by severity

### 🔴 Critical (15)

- [ ] <TBD-F-1> F-1: Secrets committed to repo (`.env`)
- [ ] <TBD-F-2> F-2: No global rate limiter
- [ ] <TBD-F-7> F-7: `/faucet/request-tokens` has no auth — drains operator
- [ ] <TBD-F-9> F-9: Race condition in `redeemAccessCode`
- [ ] <TBD-F-15> F-15: WebSocket gateway has no authentication — cross-user data leak
- [ ] <TBD-F-16> F-16: Token amount handling uses JS `Number` — precision loss
- [ ] <TBD-F-19> F-19: Chain indexer credits deposits without finality / reorg handling
- [ ] <TBD-F-23> F-23: Health-factor logic computed entirely in JS `Number` (floats)
- [ ] <TBD-F-24> F-24: Single-source oracle (CoinGecko) — missing prices silently treated as $0
- [ ] <TBD-F-25> F-25: `cancelOrder` runs without transaction or row lock — races matching engine
- [ ] <TBD-F-26> F-26: Operator key signs every user action — backend is sole authorization layer
- [ ] <TBD-F-29> F-29: Order placement performs no balance check and never locks funds
- [ ] <TBD-F-32> F-32: `ENABLE_DEV_AUTH=true` not gated by `NODE_ENV` — accidental prod = total auth bypass
- [ ] <TBD-F-35> F-35: Paired-wallet private keys generated server-side, persisted plaintext
- [ ] <TBD-F-48> F-48: `updateOrder` has the same lost-update race as `cancelOrder`

### 🟠 High (16)

- [ ] <TBD-F-3> F-3: handlebars 4.7.8 — JS injection via AST type confusion
- [ ] <TBD-F-4> F-4: jws 3.2.2 — improperly verifies HMAC signature
- [ ] <TBD-F-5> F-5: multer 2.0.2 — multiple DoS vulnerabilities
- [ ] <TBD-F-6> F-6: `/deposit/confirm` accepts arbitrary txHash
- [ ] <TBD-F-17> F-17: `DatabaseService.insert` table interpolation + DTO bound gaps
- [ ] <TBD-F-18> F-18: NATS trust boundary — gateway accepts arbitrary publishers
- [ ] <TBD-F-20> F-20: `updateOrder` allows binding markets to a different asset
- [ ] <TBD-F-27> F-27: `repay` and `withdrawLendPosition` not transactional — chain/DB desync
- [ ] <TBD-F-30> F-30: `access_granted` flag set on redemption but never read
- [ ] <TBD-F-34> F-34: Missing security headers + auto-run migrations on every boot
- [ ] <TBD-F-38> F-38: WS `subscribe-orderbook` triggers expensive DB read per request
- [ ] <TBD-F-39> F-39: Bot worker rates use `Math.random()` mid with no market anchor
- [ ] <TBD-F-41> F-41: NATS payloads expose `walletAddress` and order amounts in plaintext
- [ ] <TBD-F-43> F-43: `PriceService` ingests prices by `token.symbol` — duplicate symbols collide
- [ ] <TBD-F-45> F-45: `OrdersWorker` retry loop burns operator gas without budget
- [ ] <TBD-F-46> F-46: `viemService.writeContract` queue head-of-line blocks on hung receipt

### 🟡 Moderate (16)

- [ ] <TBD-F-10> F-10: `@nestjs/core` injection neutralization
- [ ] <TBD-F-11> F-11: `socket.io-parser` unbounded binary attachments
- [ ] <TBD-F-12> F-12: `body-parser` DoS on urlencoded
- [ ] <TBD-F-13> F-13: `AdminSecretGuard` timing attack
- [ ] <TBD-F-14> F-14: Error response leaks implementation details
- [ ] <TBD-F-21> F-21: Pagination DTOs accept unbounded `limit` and `page`
- [ ] <TBD-F-22> F-22: `PrivyService.verify` uses `console.error` — token leak risk
- [ ] <TBD-F-28> F-28: `withdrawLendPosition` gates maturity on the server clock
- [ ] <TBD-F-31> F-31: WebSocket recent-trades cache is poisonable
- [ ] <TBD-F-33> F-33: Compiled `dist/` build artifacts committed to repo
- [ ] <TBD-F-36> F-36: `getOrCreateAccount` is case-sensitive and racy
- [ ] <TBD-F-37> F-37: Privy auth path has no defense-in-depth
- [ ] <TBD-F-40> F-40: `TokensService` cache has no invalidation
- [ ] <TBD-F-42> F-42: `ChainConfigService.operatorPrivateKey` is a public readonly field
- [ ] <TBD-F-44> F-44: `CoinGeckoProvider` calls `fetch` with no timeout
- [ ] <TBD-F-47> F-47: `app.set('trust proxy')` not configured — IP throttling collapses behind any proxy

---

## How to use this epic

- **Triage**: filter the repo issues by `label:security` to see the full backlog.
- **Sequencing**: tackle the TL;DR fix path (top of this issue) before chasing CVE bumps or hygiene findings.
- **Evidence**: every child issue contains active reproduction steps, code-pointer evidence, recommended remediation with patch-grade code, and a verification recipe.
- **Composition**: criticals chain into 7 attacker outcomes — see `THREAT-MODEL.md`. The fix-path order above is calibrated to break the most chains per hour, not the most-severe-first.

## Methodology

- **Static**: gitleaks (38 leaks), pnpm audit (57 advisories at scan time), Semgrep (auto config + p/typescript + p/security-audit + p/owasp-top-ten + p/nodejs).
- **Dynamic**: dev-token spoofing, IDOR sweep, race-condition test (10 concurrent), header injection, NATS forging, websocket subscribe attacks.
- **Code review**: ownership checks per service, query parameterization, crypto usage, rate-limit wiring, transaction boundaries.

## Out of scope

- Settlement engine (different repo).
- Solidity contract review (no contracts in this repo).
- Privy SDK internals (treated as a black box; recommended defense-in-depth in F-37).
