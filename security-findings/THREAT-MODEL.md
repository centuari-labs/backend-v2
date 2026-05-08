# Threat Model — Centuari Backend v2

Composite view of how the 41 individual findings (F-1 .. F-42) chain into concrete attacker outcomes. Most single findings are recoverable; the danger is in their interactions.

This document is the **prioritization tool** for the [README index](./README.md) — when triaging, fix the findings that appear in the most attack chains first.

> **Reading order**: each chain lists steps from precondition to outcome. A 🔒 means "this single fix breaks the chain." Findings already linked to their detail files via the `[F-N]` syntax.

---

## Attack 1 — Withdraw a victim's funds without their key

**Outcome**: operator-signed transfer of victim's portfolio balance to attacker-controlled address.
**Required: 1 attacker, network-side; 0 victim involvement.**

| Step | What | Required findings |
|------|------|-------------------|
| 1 | Reach the API. Repo is private but `.env` is committed in tree. Cloning the repo gives `OPERATOR_PRIVATE_KEY`, `ACCESS_CODE_ADMIN_SECRET`, `PRIVY_PROJECT_SECRET` directly. | [F-1](./F-1-secrets-committed.md) |
| 2 | Identify a victim. WebSocket has no auth and `subscribe-orderbook` returns every active order. Subscribe with arbitrary `accountId` to `active-positions` to harvest victim wallets and amounts. | [F-15](./F-15-websocket-no-auth.md) [F-41](./F-41-nats-payload-pii-exposure.md) |
| 3 | Authenticate as the victim. `ENABLE_DEV_AUTH=true` is in committed `.env` and not gated by `NODE_ENV`; `DEV_TOKEN_0xVICTIM_WALLET` validates as that wallet. | [F-32](./F-32-enable-dev-auth-not-prod-gated.md) [F-1](./F-1-secrets-committed.md) |
| 4 | Bypass HF check. Pick a token with no `coingecko_id` (or hit the cold-start window). `priceMap.get(...) ?? 0` makes either side worthless; `totalDebtUsd <= 0` returns `Infinity` HF; withdraw passes solvency gate. Float drift in HF math seals the corner cases. | [F-24](./F-24-oracle-single-source.md) [F-23](./F-23-health-factor-floats.md) |
| 5 | Place a withdraw / repay request. No transactional / row lock — a concurrent cancel on a previously-matched order doesn't decrement balances. | [F-25](./F-25-cancel-vs-fill-race.md) [F-27](./F-27-repay-withdraw-toctou.md) [F-29](./F-29-no-balance-check-on-order.md) |
| 6 | Backend computes `amountInBaseUnits` via `Number()` of an 18-decimal string. Precision loss above `2^53` lets attacker overshoot balance by sub-unit amounts the comparison can't see. | [F-16](./F-16-money-precision-loss.md) |
| 7 | Operator signs the on-chain `Treasury.withdraw(token, walletAddress, amount)`. Contract has no user-signature check; operator's signature is sufficient. | [F-26](./F-26-operator-key-blast-radius.md) |
| 8 | Funds land at attacker's wallet. | — |

**Single-fix break-points** (any one breaks the chain entirely):

- 🔒 [F-32](./F-32-enable-dev-auth-not-prod-gated.md) — fail-closed boot guard for `ENABLE_DEV_AUTH`. Step 3 fails. Estimated effort: **15 min**.
- 🔒 [F-1](./F-1-secrets-committed.md) — rotate keys, scrub history. Step 1 fails (no operator key in repo). Estimated effort: **~1 h**.
- 🔒 [F-26](./F-26-operator-key-blast-radius.md) — move signing to KMS / require user-signed permits. Step 7 fails. Estimated effort: **~4–8 h** (architectural).

Even fixing F-32 alone closes the simplest version of this attack against a misconfigured production deploy. Highest ROI single fix in the entire report.

---

## Attack 2 — Drain the operator wallet's gas balance

**Outcome**: every operator-signed transfer eventually reverts because operator has no ETH for gas. Service degradation; user funds stuck (because the same operator signs withdraws — F-26).
**Required: 0 attacker auth.**

| Step | What | Required findings |
|------|------|-------------------|
| 1 | Hit `/faucet/request-tokens` from any IP, with attacker as `recipientAddress`. No auth, no rate limit. Each request is an on-chain transaction signed and gas-paid by the operator. | [F-7](./F-7-faucet-no-auth.md) [F-2](./F-2-no-global-rate-limiter.md) |
| 2 | Loop. With `~100 req/sec` × `~0.0005 ETH gas`, the operator burns `~180 ETH/hour` of testnet ETH. On a chain with paid gas, that's a real liquidity hit. | [F-7](./F-7-faucet-no-auth.md) [F-2](./F-2-no-global-rate-limiter.md) |
| 3 | Compounded by `/deposit/confirm` accepting arbitrary `txHash` — every authenticated request triggers an RPC `getTransactionReceipt` call. Burns RPC quota, not gas, but contributes to operator-side starvation. | [F-6](./F-6-deposit-confirm-idor.md) |
| 4 | Compounded by chain indexer with no finality — submitted-then-reorged deposits remain credited in DB. Attacker can withdraw against the credit, doubling operator gas burn per "stolen" deposit. | [F-19](./F-19-chain-indexer-no-finality.md) |

**Single-fix break-points**:

- 🔒 [F-7](./F-7-faucet-no-auth.md) — auth + per-wallet daily quota. Step 1 fails. **~20 min**.
- 🔒 [F-2](./F-2-no-global-rate-limiter.md) — `APP_GUARD` ThrottlerGuard. Steps 1 + 2 throttle. **~10 min**.

---

## Attack 3 — Front-run every market order

**Outcome**: attacker captures the spread on every user-placed market order without holding inventory.
**Required: 0 auth (with current state) or attacker auth (post-F-15 fix).**

| Step | What | Required findings |
|------|------|-------------------|
| 1 | Eavesdrop on the orderbook. NATS `orders.>` has no auth and the gateway re-broadcasts every event to its WS rooms with no auth. Either entry point gives a real-time, attributed feed of every order. | [F-18](./F-18-nats-trust-boundary.md) [F-15](./F-15-websocket-no-auth.md) [F-41](./F-41-nats-payload-pii-exposure.md) |
| 2 | Place phantom liquidity at the targeted rate. Order placement performs no balance check or lock — attacker creates a $1B lend order at the rate that matches the victim's incoming market order. | [F-29](./F-29-no-balance-check-on-order.md) |
| 3 | Victim's market order matches against the phantom order. Matching engine sees liquidity. Settlement begins. | — (phantom liquidity already in book) |
| 4 | Cancel the phantom order before settlement reverts. `cancelOrder` runs without a row lock, so it overwrites the engine's `filled_quantity` write — DB reads "cancelled, fill 0" while the on-chain settlement for the phantom side is in flight. | [F-25](./F-25-cancel-vs-fill-race.md) |
| 5 | Claim the spread via the cancel race window — DB shows you never owed the funds; on-chain the engine retries against the next best (real) liquidity at a worse rate for the victim. | [F-25](./F-25-cancel-vs-fill-race.md) [F-27](./F-27-repay-withdraw-toctou.md) |

**Single-fix break-points**:

- 🔒 [F-29](./F-29-no-balance-check-on-order.md) — lock `portfolio.locked_amount` on order create. Step 2 fails (insufficient balance). **~3–5 h**.
- 🔒 [F-25](./F-25-cancel-vs-fill-race.md) — wrap `cancelOrder` in tx + `FOR UPDATE`. Step 4 fails. **~1–2 h**.
- 🔒 [F-15](./F-15-websocket-no-auth.md) — auth WS handshake + server-derived rooms. Step 1 partial fix; eavesdropping moves to NATS only (still possible until F-18). **~45 min**.

---

## Attack 4 — Eavesdrop on every user's wallet ↔ trading-history mapping

**Outcome**: complete real-time map of `walletAddress → trade history` for every user. Privacy / regulatory exposure.
**Required: LAN-adjacent attacker (NATS path) or any web origin (WS path).**

| Step | What | Required findings |
|------|------|-------------------|
| 1 | Connect to NATS port `4222` (published on `0.0.0.0` in dev `docker run`). No auth required. | [F-18](./F-18-nats-trust-boundary.md) |
| 2 | Subscribe to `orders.>` and `matches.>`. Receive every order's `walletAddress`, full `originalAmount`, `rate`, market list, fill events, cancellations. | [F-41](./F-41-nats-payload-pii-exposure.md) |
| 3 | Cross-reference with the WS gateway: open a socket from any web origin (CORS `*` outside production), subscribe to `active-positions` with the harvested `accountId`s, receive any positions the NATS feed missed. | [F-15](./F-15-websocket-no-auth.md) |
| 4 | Optionally: also subscribe to `prices` to time the cold-start oracle window for [Attack 1](#attack-1-—-withdraw-a-victims-funds-without-their-key). | [F-15](./F-15-websocket-no-auth.md) [F-24](./F-24-oracle-single-source.md) |

**Single-fix break-points**:

- 🔒 [F-18](./F-18-nats-trust-boundary.md) — NATS auth + bind to localhost. Step 1 fails. **~1 h**.
- 🔒 [F-41](./F-41-nats-payload-pii-exposure.md) — drop `walletAddress` from NATS payloads, use `accountId`. Step 2 returns opaque IDs only. **~3–4 h**.
- 🔒 [F-15](./F-15-websocket-no-auth.md) — auth WS + server-derived rooms. Step 3 fails. **~45 min**.

The compositional fix is to **stop using PII as the primary key on internal messaging** — `accountId` (UUID, server-derived) suffices. F-41 is the right anchor.

---

## Attack 5 — Cause protocol-wide solvency drift

**Outcome**: DB amounts diverge from on-chain reality. Eventually, withdrawals fail / users lose funds / the protocol's solvency reporting is wrong by an unbounded amount.
**Required: 1 attacker, can be unauthenticated.**

| Step | What | Required findings |
|------|------|-------------------|
| 1 | Send a deposit on chain. Indexer credits portfolio at tip-block, no confirmation depth. | [F-19](./F-19-chain-indexer-no-finality.md) |
| 2 | Cause a chain reorg (testnet sequencers reorg routinely on Arbitrum L2; mainnet attackers can buy reorgs in some chains). The deposit tx is no longer in canonical chain. | [F-19](./F-19-chain-indexer-no-finality.md) |
| 3 | Withdraw the credit. Operator signs `Treasury.withdraw` for an amount that was never actually deposited on the canonical chain. | [F-26](./F-26-operator-key-blast-radius.md) [F-27](./F-27-repay-withdraw-toctou.md) |
| 4 | Treasury has lost real funds. DB shows withdrawal succeeded. No reconciliation job notices because none exists. | [F-19](./F-19-chain-indexer-no-finality.md) |

Variant that doesn't require a reorg, only float drift:

- Place borrow at an amount whose `Number(dto.amount) * assetPrice` rounds *down* in HF math. HF check passes for an undercollateralized position. Operator signs the borrow. Position is real-money short of collateral. | [F-23](./F-23-health-factor-floats.md) [F-16](./F-16-money-precision-loss.md) |

**Single-fix break-points**:

- 🔒 [F-19](./F-19-chain-indexer-no-finality.md) — wait for confirmations + reorg compensation. Steps 1–2 fail. **~2–4 h**.
- 🔒 [F-23](./F-23-health-factor-floats.md) — BigInt fixed-point HF math. Variant blocked. **~3–5 h**.

---

## Attack 6 — Take the backend down with one client

**Outcome**: legitimate users see 503s / timeouts. Operator can't drain funds in response (even if they wanted to) because every recovery path runs through the same overloaded backend.
**Required: 1 attacker, no auth, low bandwidth.**

| Step | What | Required findings |
|------|------|-------------------|
| 1 | Open 100 WebSocket connections from any origin. No auth, no per-IP cap. | [F-15](./F-15-websocket-no-auth.md) |
| 2 | On each socket, fire `subscribe-orderbook` with random UUIDs at 20 events/sec. Each fires a Postgres query for `findActiveLimitOrdersForOrderbook` + BigInt-heavy aggregation + room broadcast. | [F-38](./F-38-ws-orderbook-amplifier.md) |
| 3 | Pool exhaustion. `/portfolio/*` and `/orders/*` REST endpoints time out. With no `statement_timeout` (per F-21), bad queries linger and starve good ones. | [F-21](./F-21-pagination-unbounded.md) [F-38](./F-38-ws-orderbook-amplifier.md) |
| 4 | Add: `?limit=1000000` on `/portfolio/order-history` to return millions of rows. | [F-21](./F-21-pagination-unbounded.md) |
| 5 | Add: forge `matches.created` events on NATS to grow `recentTradesCache` Map indefinitely (any `assetId` allocates a new entry). RSS climbs until OOM-kill. | [F-31](./F-31-recent-trades-cache-poisoning.md) [F-18](./F-18-nats-trust-boundary.md) |

**Single-fix break-points**:

- 🔒 [F-2](./F-2-no-global-rate-limiter.md) — global ThrottlerGuard. Step 1 throttled. **~10 min**.
- 🔒 [F-15](./F-15-websocket-no-auth.md) — WS auth + per-IP caps. Step 1 fails. **~45 min**.

---

## Attack 7 — Bypass the access-code beta gate

**Outcome**: attacker uses every authenticated feature without a redemption (or, in the strict variant, with infinite redemptions).
**Required: 0 auth.**

| Step | What | Required findings |
|------|------|-------------------|
| 1 | Auth as anyone via dev token. | [F-32](./F-32-enable-dev-auth-not-prod-gated.md) |
| 2 | Place orders, withdraw, repay. The `access_granted` flag is never read by any controller, guard, or service. The entire access-code system is decorative. | [F-30](./F-30-access-granted-not-enforced.md) |
| 2'. (optional) Generate access codes anyway. `ACCESS_CODE_ADMIN_SECRET` is in committed `.env`. | [F-1](./F-1-secrets-committed.md) [F-13](./F-13-admin-secret-timing.md) |
| 3'. (optional) Distribute codes via the F-9 race so each can be redeemed N times. | [F-9](./F-9-access-code-race.md) |

**Single-fix break-points**:

- 🔒 [F-30](./F-30-access-granted-not-enforced.md) — `AccessGrantedGuard` (or delete the system). **~1 h**.
- 🔒 [F-32](./F-32-enable-dev-auth-not-prod-gated.md) — fail-closed boot guard. **~15 min**.

---

## Cross-attack finding-frequency table

How many of the 7 attack chains each finding appears in. **Higher = higher fix priority.**

| Finding | Sev | Chains | Effort |
|---------|-----|--------|--------|
| [F-1](./F-1-secrets-committed.md) — secrets committed | 🔴 | 3 (1, 2, 7) | ~1 h |
| [F-2](./F-2-no-global-rate-limiter.md) — no global throttler | 🔴 | 2 (2, 6) | 10 min |
| [F-7](./F-7-faucet-no-auth.md) — faucet no auth | 🔴 | 1 (2) | 20 min |
| [F-9](./F-9-access-code-race.md) — code redeem race | 🔴 | 1 (7) | 20 min |
| [F-15](./F-15-websocket-no-auth.md) — WS no auth | 🔴 | 4 (1, 3, 4, 6) | 45 min |
| [F-16](./F-16-money-precision-loss.md) — withdraw precision | 🔴 | 2 (1, 5) | 1–2 h |
| [F-18](./F-18-nats-trust-boundary.md) — NATS trust | 🟠 | 2 (3, 4) | 1 h |
| [F-19](./F-19-chain-indexer-no-finality.md) — indexer no finality | 🔴 | 1 (5) | 2–4 h |
| [F-21](./F-21-pagination-unbounded.md) — pagination | 🟡 | 1 (6) | 15 min |
| [F-23](./F-23-health-factor-floats.md) — HF floats | 🔴 | 2 (1, 5) | 3–5 h |
| [F-24](./F-24-oracle-single-source.md) — oracle | 🔴 | 1 (1) | 2–3 h |
| [F-25](./F-25-cancel-vs-fill-race.md) — cancel race | 🔴 | 2 (1, 3) | 1–2 h |
| [F-48](./F-48-update-order-lost-update-race.md) — updateOrder race | 🔴 | 2 (1, 3) | 1 h |
| [F-26](./F-26-operator-key-blast-radius.md) — operator key | 🔴 | 3 (1, 5, 7-implicit) | 4–8 h |
| [F-27](./F-27-repay-withdraw-toctou.md) — repay TOCTOU | 🟠 | 2 (1, 5) | 4–6 h |
| [F-29](./F-29-no-balance-check-on-order.md) — no balance check | 🔴 | 1 (3) | 3–5 h |
| [F-30](./F-30-access-granted-not-enforced.md) — access-granted unenforced | 🟠 | 1 (7) | 1 h |
| [F-31](./F-31-recent-trades-cache-poisoning.md) — recent-trades cache | 🟡 | 1 (6) | 1 h |
| [F-32](./F-32-enable-dev-auth-not-prod-gated.md) — dev auth not gated | 🔴 | 2 (1, 7) | 15 min |
| [F-38](./F-38-ws-orderbook-amplifier.md) — WS orderbook | 🟠 | 1 (6) | 1 h |
| [F-41](./F-41-nats-payload-pii-exposure.md) — NATS PII | 🟠 | 1 (4) | 3–4 h |

(F-3..F-6, F-10..F-14, F-17, F-20, F-22, F-28, F-33..F-37, F-39, F-40, F-42 each appear in 0–1 attack chains and are not the priority gates.)

---

## Recommended remediation order, by attack-chain coverage

If the team has 1 day to spend on security, do these in order — each step closes the most attack chains per hour invested:

| # | Action | Closes chains | Time |
|---|--------|---------------|------|
| 1 | [F-32](./F-32-enable-dev-auth-not-prod-gated.md) — fail-closed boot guard | 1, 7 | 15 min |
| 2 | [F-2](./F-2-no-global-rate-limiter.md) — wire global ThrottlerGuard | 2, 6 | 10 min |
| 3 | [F-15](./F-15-websocket-no-auth.md) — WS auth + server-derived rooms | 1, 3, 4, 6 | 45 min |
| 4 | [F-7](./F-7-faucet-no-auth.md) — faucet auth + per-wallet quota | 2 | 20 min |
| 5 | [F-30](./F-30-access-granted-not-enforced.md) — `AccessGrantedGuard` | 7 | 1 h |
| 6 | [F-1](./F-1-secrets-committed.md) — rotate keys, scrub history | 1, 2, 7 | 1 h |
| 7 | [F-25](./F-25-cancel-vs-fill-race.md) — `cancelOrder` tx + `FOR UPDATE` | 1, 3 | 1–2 h |
| 8 | [F-18](./F-18-nats-trust-boundary.md) — NATS auth + localhost bind | 3, 4 | 1 h |

≈ 5–6 hours of work closes 6 of the 7 attack chains. **All "free money" attacks (1, 5) are still open after this** — those need [F-19](./F-19-chain-indexer-no-finality.md) (reorg compensation, ~2–4 h), [F-23](./F-23-health-factor-floats.md) (HF BigInt, ~3–5 h), [F-24](./F-24-oracle-single-source.md) (oracle hardening, ~2–3 h), [F-26](./F-26-operator-key-blast-radius.md) (KMS / signer separation, ~4–8 h), and [F-29](./F-29-no-balance-check-on-order.md) (balance lock, ~3–5 h) — another ~14–25 hours of work.

After that, the remaining 20+ findings are independent hardening work that can be parallelized across the team.

---

## What's *not* covered by these chains

The 7 chains above cover the major user-impacting outcomes. Findings that don't slot into a chain are real but secondary:

- **F-3, F-4, F-5, F-10, F-11, F-12** — transitive CVEs. Real, but exploitation requires a specific upstream code path. Run `pnpm update`; it's 5 minutes of work. (F-4 is the riskier one — JWT verification — but only if `passport-jwt` is actually wired anywhere; today it isn't.)
- **F-13** — admin secret timing attack. Mitigated once F-2 is in place.
- **F-14, F-22, F-33** — info disclosure / dist tracking / log hygiene. Real but not on a critical chain.
- **F-17** — `DatabaseService.insert` table interpolation. Latent footgun, not exploitable today.
- **F-20** — cross-asset markets in update. Real but limited blast radius.
- **F-28, F-36, F-40** — clock / case / cache hygiene. UX-grade bugs that compound under load.
- **F-34** — helmet + migrate-on-start. Hygiene, not on a critical chain — but the migrate-on-start half is operationally dangerous and easy to fix.
- **F-35** — paired-wallet plaintext private key. Currently dormant (table doesn't exist). The migration that adds the table activates a critical. Block the migration until the design is fixed.
- **F-37, F-39, F-42** — defense-in-depth on Privy verification, bot rate sourcing, operator-key encapsulation. Mainnet-relevant; testnet-tolerable.

The full list with one-line descriptions is in [README.md](./README.md).

---

## Operational principle

The single architectural sentence that captures the report:

> **The on-chain protocol trusts the operator. The operator trusts the backend. The backend trusts itself, but it shouldn't.**

Most criticals are different ways the backend is wrong about reality (its caches, its math, its inputs, its prior writes, its NATS feed). When the backend is wrong, the operator signs the wrong on-chain tx. F-26 is the architectural reason that's catastrophic; everything else is the specific way the backend lies.

The durable fix is to **shrink the backend's authority** — user-signed permits, on-chain access control, encrypted internal messaging, KMS signing. The findings in the report are the patches that get the team there; the threat model is why each one matters.
