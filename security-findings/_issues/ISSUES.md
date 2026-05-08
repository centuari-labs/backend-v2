# GitHub Issues — Manual Upload Guide

Copy-paste guide for converting the 47 pentest findings + tracking epic into GitHub issues.

---

## 1. Set up labels first (one-time)

Open https://github.com/centuari-labs/backend-v2/labels and create:

| Name | Color | Description |
|------|-------|-------------|
| `security` | `#B60205` | Security finding from pentest 2026-05-08 |
| `severity:critical` | `#B60205` | Pentest severity: critical |
| `severity:high` | `#D93F0B` | Pentest severity: high |
| `severity:moderate` | `#FBCA04` | Pentest severity: moderate |

Or via `gh` CLI (after `gh auth login`):

```bash
gh label create security           --color B60205 --description "Security finding from pentest 2026-05-08"
gh label create severity:critical  --color B60205 --description "Pentest severity: critical"
gh label create severity:high      --color D93F0B --description "Pentest severity: high"
gh label create severity:moderate  --color FBCA04 --description "Pentest severity: moderate"
```

---

## 2. Create the tracking epic (do this first)

| Field | Value |
|-------|-------|
| **Title** | `Pentest 2026-05-08 — 44 findings tracking` |
| **Labels** | `security` |
| **Body** | paste full content of [`_epic-body.md`](./_epic-body.md) |

After it's created, note the issue number (e.g. `#100`). You'll edit the body later to fill in child issue numbers.

---

## 3. Create the 44 child issues

For each row below:

1. Open https://github.com/centuari-labs/backend-v2/issues/new
2. **Title**: paste the "Title" column verbatim
3. **Body**: paste the contents of the `Body file` column (the existing `F-N-*.md` file in the parent `security-findings/` directory, the entire file works as the issue body — H1 + content)
4. **Labels**: click "Labels" and apply both labels in the "Labels" column
5. (Optional) Reference the epic in the body: append `Tracked under #<epic-number>.`

---

### 🔴 Critical (15)

| # | Title | Labels | Body file |
|---|-------|--------|-----------|
| F-1 | F-1: Secrets committed to repo (`.env`) | `security`, `severity:critical` | [`F-1-secrets-committed.md`](../F-1-secrets-committed.md) |
| F-2 | F-2: No global rate limiter | `security`, `severity:critical` | [`F-2-no-global-rate-limiter.md`](../F-2-no-global-rate-limiter.md) |
| F-7 | F-7: `/faucet/request-tokens` has no auth — drains operator | `security`, `severity:critical` | [`F-7-faucet-no-auth.md`](../F-7-faucet-no-auth.md) |
| F-9 | F-9: Race condition in `redeemAccessCode` | `security`, `severity:critical` | [`F-9-access-code-race.md`](../F-9-access-code-race.md) |
| F-15 | F-15: WebSocket gateway has no authentication — cross-user data leak | `security`, `severity:critical` | [`F-15-websocket-no-auth.md`](../F-15-websocket-no-auth.md) |
| F-16 | F-16: Token amount handling uses JS `Number` — precision loss | `security`, `severity:critical` | [`F-16-money-precision-loss.md`](../F-16-money-precision-loss.md) |
| F-19 | F-19: Chain indexer credits deposits without finality / reorg handling | `security`, `severity:critical` | [`F-19-chain-indexer-no-finality.md`](../F-19-chain-indexer-no-finality.md) |
| F-23 | F-23: Health-factor logic computed entirely in JS `Number` (floats) | `security`, `severity:critical` | [`F-23-health-factor-floats.md`](../F-23-health-factor-floats.md) |
| F-24 | F-24: Single-source oracle (CoinGecko) — missing prices silently treated as $0 | `security`, `severity:critical` | [`F-24-oracle-single-source.md`](../F-24-oracle-single-source.md) |
| F-25 | F-25: `cancelOrder` runs without transaction or row lock — races matching engine | `security`, `severity:critical` | [`F-25-cancel-vs-fill-race.md`](../F-25-cancel-vs-fill-race.md) |
| F-26 | F-26: Operator key signs every user action — backend is sole authorization layer | `security`, `severity:critical` | [`F-26-operator-key-blast-radius.md`](../F-26-operator-key-blast-radius.md) |
| F-29 | F-29: Order placement performs no balance check and never locks funds | `security`, `severity:critical` | [`F-29-no-balance-check-on-order.md`](../F-29-no-balance-check-on-order.md) |
| F-32 | F-32: `ENABLE_DEV_AUTH=true` not gated by `NODE_ENV` — accidental prod = total auth bypass | `security`, `severity:critical` | [`F-32-enable-dev-auth-not-prod-gated.md`](../F-32-enable-dev-auth-not-prod-gated.md) |
| F-35 | F-35: Paired-wallet private keys generated server-side, persisted plaintext | `security`, `severity:critical` | [`F-35-paired-wallet-private-key-plaintext.md`](../F-35-paired-wallet-private-key-plaintext.md) |
| F-48 | F-48: `updateOrder` has the same lost-update race as `cancelOrder` | `security`, `severity:critical` | [`F-48-update-order-lost-update-race.md`](../F-48-update-order-lost-update-race.md) |

### 🟠 High (15)

| # | Title | Labels | Body file |
|---|-------|--------|-----------|
| F-3 | F-3: handlebars 4.7.8 — JS injection via AST type confusion | `security`, `severity:high` | [`F-3-handlebars-cve.md`](../F-3-handlebars-cve.md) |
| F-4 | F-4: jws 3.2.2 — improperly verifies HMAC signature | `security`, `severity:high` | [`F-4-jws-cve.md`](../F-4-jws-cve.md) |
| F-5 | F-5: multer 2.0.2 — multiple DoS vulnerabilities | `security`, `severity:high` | [`F-5-multer-cve.md`](../F-5-multer-cve.md) |
| F-6 | F-6: `/deposit/confirm` accepts arbitrary txHash | `security`, `severity:high` | [`F-6-deposit-confirm-idor.md`](../F-6-deposit-confirm-idor.md) |
| F-17 | F-17: `DatabaseService.insert` table interpolation + DTO bound gaps | `security`, `severity:high` | [`F-17-databaseservice-insert-and-dto-gaps.md`](../F-17-databaseservice-insert-and-dto-gaps.md) |
| F-18 | F-18: NATS trust boundary — gateway accepts arbitrary publishers | `security`, `severity:high` | [`F-18-nats-trust-boundary.md`](../F-18-nats-trust-boundary.md) |
| F-20 | F-20: `updateOrder` allows binding markets to a different asset | `security`, `severity:high` | [`F-20-update-order-cross-asset-markets.md`](../F-20-update-order-cross-asset-markets.md) |
| F-27 | F-27: `repay` and `withdrawLendPosition` not transactional — chain/DB desync | `security`, `severity:high` | [`F-27-repay-withdraw-toctou.md`](../F-27-repay-withdraw-toctou.md) |
| F-30 | F-30: `access_granted` flag set on redemption but never read | `security`, `severity:high` | [`F-30-access-granted-not-enforced.md`](../F-30-access-granted-not-enforced.md) |
| F-34 | F-34: Missing security headers + auto-run migrations on every boot | `security`, `severity:high` | [`F-34-helmet-and-migrate-on-start.md`](../F-34-helmet-and-migrate-on-start.md) |
| F-38 | F-38: WS `subscribe-orderbook` triggers expensive DB read per request | `security`, `severity:high` | [`F-38-ws-orderbook-amplifier.md`](../F-38-ws-orderbook-amplifier.md) |
| F-39 | F-39: Bot worker rates use `Math.random()` mid with no market anchor | `security`, `severity:high` | [`F-39-bot-rates-no-market-anchor.md`](../F-39-bot-rates-no-market-anchor.md) |
| F-41 | F-41: NATS payloads expose `walletAddress` and order amounts in plaintext | `security`, `severity:high` | [`F-41-nats-payload-pii-exposure.md`](../F-41-nats-payload-pii-exposure.md) |
| F-43 | F-43: `PriceService` ingests prices by `token.symbol` — duplicate symbols collide | `security`, `severity:high` | [`F-43-price-symbol-collision.md`](../F-43-price-symbol-collision.md) |
| F-45 | F-45: `OrdersWorker` retry loop burns operator gas without budget | `security`, `severity:high` | [`F-45-bot-worker-gas-burn-no-budget.md`](../F-45-bot-worker-gas-burn-no-budget.md) |
| F-46 | F-46: `viemService.writeContract` queue head-of-line blocks on hung receipt | `security`, `severity:high` | [`F-46-no-tx-timeouts-head-of-line-block.md`](../F-46-no-tx-timeouts-head-of-line-block.md) |

### 🟡 Moderate (15)

| # | Title | Labels | Body file |
|---|-------|--------|-----------|
| F-10 | F-10: `@nestjs/core` injection neutralization | `security`, `severity:moderate` | [`F-10-nestjs-core-cve.md`](../F-10-nestjs-core-cve.md) |
| F-11 | F-11: `socket.io-parser` unbounded binary attachments | `security`, `severity:moderate` | [`F-11-socketio-parser-cve.md`](../F-11-socketio-parser-cve.md) |
| F-12 | F-12: `body-parser` DoS on urlencoded | `security`, `severity:moderate` | [`F-12-body-parser-dos.md`](../F-12-body-parser-dos.md) |
| F-13 | F-13: `AdminSecretGuard` timing attack | `security`, `severity:moderate` | [`F-13-admin-secret-timing.md`](../F-13-admin-secret-timing.md) |
| F-14 | F-14: Error response leaks implementation details | `security`, `severity:moderate` | [`F-14-error-info-disclosure.md`](../F-14-error-info-disclosure.md) |
| F-21 | F-21: Pagination DTOs accept unbounded `limit` and `page` | `security`, `severity:moderate` | [`F-21-pagination-unbounded.md`](../F-21-pagination-unbounded.md) |
| F-22 | F-22: `PrivyService.verify` uses `console.error` — token leak risk | `security`, `severity:moderate` | [`F-22-privy-console-error-leak.md`](../F-22-privy-console-error-leak.md) |
| F-28 | F-28: `withdrawLendPosition` gates maturity on the server clock | `security`, `severity:moderate` | [`F-28-server-clock-maturity.md`](../F-28-server-clock-maturity.md) |
| F-31 | F-31: WebSocket recent-trades cache is poisonable | `security`, `severity:moderate` | [`F-31-recent-trades-cache-poisoning.md`](../F-31-recent-trades-cache-poisoning.md) |
| F-33 | F-33: Compiled `dist/` build artifacts committed to repo | `security`, `severity:moderate` | [`F-33-dist-build-artifacts-committed.md`](../F-33-dist-build-artifacts-committed.md) |
| F-36 | F-36: `getOrCreateAccount` is case-sensitive and racy | `security`, `severity:moderate` | [`F-36-account-lookup-case-and-race.md`](../F-36-account-lookup-case-and-race.md) |
| F-37 | F-37: Privy auth path has no defense-in-depth | `security`, `severity:moderate` | [`F-37-privy-no-defense-in-depth.md`](../F-37-privy-no-defense-in-depth.md) |
| F-40 | F-40: `TokensService` cache has no invalidation | `security`, `severity:moderate` | [`F-40-tokens-cache-no-invalidation.md`](../F-40-tokens-cache-no-invalidation.md) |
| F-42 | F-42: `ChainConfigService.operatorPrivateKey` is a public readonly field | `security`, `severity:moderate` | [`F-42-chainconfig-public-operator-key.md`](../F-42-chainconfig-public-operator-key.md) |
| F-44 | F-44: `CoinGeckoProvider` calls `fetch` with no timeout | `security`, `severity:moderate` | [`F-44-coingecko-fetch-no-timeout.md`](../F-44-coingecko-fetch-no-timeout.md) |
| F-47 | F-47: `app.set('trust proxy')` not configured — IP throttling collapses behind any proxy | `security`, `severity:moderate` | [`F-47-trust-proxy-ip-throttling.md`](../F-47-trust-proxy-ip-throttling.md) |

---

## 4. After all 44 child issues exist — link them in the epic

Edit the epic issue body (the placeholder `_epic-body.md` content) and replace each `<TBD>` token with the real GitHub issue number.

Quick sed-friendly mapping form (fill in as you go):

```
F-1   → #
F-2   → #
F-3   → #
F-4   → #
F-5   → #
F-6   → #
F-7   → #
F-9   → #
F-10  → #
F-11  → #
F-12  → #
F-13  → #
F-14  → #
F-15  → #
F-16  → #
F-17  → #
F-18  → #
F-19  → #
F-20  → #
F-21  → #
F-22  → #
F-23  → #
F-24  → #
F-25  → #
F-26  → #
F-27  → #
F-28  → #
F-29  → #
F-30  → #
F-31  → #
F-32  → #
F-33  → #
F-34  → #
F-35  → #
F-36  → #
F-37  → #
F-38  → #
F-39  → #
F-40  → #
F-41  → #
F-42  → #
F-43  → #
F-44  → #
F-45  → #
F-46  → #
F-47  → #
F-48  → #
```

GitHub auto-renders `#NNN` as cross-references, so once filled in, the epic shows progress on each child.

---

## 5. Recommended creation order (optional)

Per [`THREAT-MODEL.md`](../THREAT-MODEL.md), creating issues in this order makes the epic's checklist match the "fix this first" priority:

1. **Quick wins (≤ 1 h each)**: F-32, F-2, F-7, F-9, F-13, F-14, F-21, F-22, F-28, F-30, F-33
2. **High-leverage (1–2 h)**: F-15, F-1, F-25, F-18, F-17, F-36, F-37, F-40, F-44
3. **Architectural (>2 h)**: F-19, F-23, F-24, F-26, F-27, F-29, F-34, F-35, F-38, F-39, F-41, F-42, F-43, F-45
4. **CVE bumps (one PR closes most)**: F-3, F-4, F-5, F-6, F-10, F-11, F-12, F-16, F-20, F-31

Or just go in F-N order and let the labels do the filtering.

---

## Tip — `gh` CLI batch creation if you change your mind later

Once `gh auth login` is done, this one-liner creates all 44 child issues from the markdown files:

```bash
cd security-findings
for f in F-*.md; do
    n=$(echo "$f" | sed 's/^F-\([0-9]\+\).*/\1/')
    title=$(head -1 "$f" | sed 's/^# //')
    sev=$(grep -m1 'Severity' "$f" | grep -oE '🔴|🟠|🟡' | head -1)
    case "$sev" in
        🔴) lvl=critical ;;
        🟠) lvl=high ;;
        🟡) lvl=moderate ;;
    esac
    gh issue create --title "$title" --body-file "$f" --label "security,severity:$lvl"
done
```

(Sleeps ~1.5 s per issue under GitHub's rate limit; ~80 s end-to-end.)
