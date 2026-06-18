# backend-v2 — Test Coverage Baseline (2026-06-08)

External-audit prep, **Phase 2.3** (hub-only scope). Captured with
`TZ=UTC pnpm exec jest --coverage` (Jest 30 + ts-jest; unit suite in `src/__test__/`).
Gives the firm a pre-audit baseline and us a regression guard. Companion:
[`dependency-scan-2026-06-08.md`](./dependency-scan-2026-06-08.md).

## Suite result

```
Test Suites: 50 passed, 50 total
Tests:       555 passed, 555 total
Time:        ~11–33 s
```

## Totals (Istanbul, `collectCoverageFrom: src/**/*.(t|j)s`)

| Metric | % | Covered / Total |
|---|---|---|
| Statements | 64.46% | 2569 / 3985 |
| Branches | 59.39% | 1245 / 2096 |
| Functions | 54.53% | 355 / 651 |
| Lines | 64.33% | 2399 / 3729 |

> **Headline caveat:** the repo's `collectCoverageFrom` glob includes the test tree and
> stubs themselves (`src/__test__/**`), which report ~9% and **depress** the totals. Excluding
> non-product files, effective product coverage is materially higher than the headline. No config
> was changed for this baseline (capture-only).

## Per top-level module (line % / function % / # files)

| Module | Lines | Functions | Files | Note |
|---|---|---|---|---|
| `withdraw` | 100.0% | 100.0% | 2 | HF-gated withdrawal path — fully covered |
| `health` | 100.0% | 100.0% | 1 | |
| `price` | 95.4% | 100.0% | 6 | oracle push/pull + providers |
| `market` | 94.2% | 81.4% | 7 | |
| `auth` | 91.8% | 53.3% | 4 | Privy/JWT guards covered; some helpers untested |
| `common` | 81.5% | 74.1% | 17 | |
| `faucet` | 80.5% | 79.2% | 1 | |
| `core` | 79.3% | 70.6% | 13 | database/nats/privy/viem/websocket infra |
| `deposit` | 77.8% | 80.0% | 1 | |
| `orders` | 70.9% | 64.7% | 15 | matching/intake trust boundary |
| `tokens` | 70.8% | 41.2% | 4 | `token-order.config.ts` largely untested |
| `collateral` | 63.0% | 30.0% | 4 | **lowest functional coverage among product code** |
| `portfolio` | 49.9% | 50.6% | 8 | `portfolio.repository.ts` (8.8%) + `portfolio.service.ts` drag it down |
| `__test__` | 8.9% | 9.6% | 11 | test fixtures/stubs counted by the glob (see caveat) |

## Notable gaps for the firm's attention

- **`portfolio/repositories/portfolio.repository.ts` (~8.8% lines):** large raw-SQL repository,
  mostly uncovered. High-value target — it computes balances/positions feeding HF.
- **`portfolio/portfolio.service.ts` (~51%):** HF/position aggregation, partially covered.
- **`collateral` (30% functions):** collateral flag/unflag orchestration — security-relevant.
- **`tokens/repositories` / `tokens/token-order.config.ts`:** config + repo glue, low coverage.

These are **observations, not defects** — no behavior was changed in this pass.

## Reproduce

```bash
pnpm install
TZ=UTC pnpm exec jest --coverage --coverageReporters=text-summary --coverageReporters=json-summary
# detailed table: TZ=UTC pnpm run test:cov
```

> **Environment note:** `src/__test__/portfolio/hf-cross-check.test.ts` reads a shared fixture from
> the sibling `smart-contract-revamp` repo via a relative path (`../../../../smart-contract-revamp/
> test/fixtures/hf-cross-check-vectors.json`). In a normal sibling checkout this resolves and the
> suite passes (555 tests). Under per-session **git-worktree isolation** the relative path resolves
> into `.claude/worktrees/`, so the fixture is not found unless `smart-contract-revamp` is symlinked
> alongside. The numbers above were captured with that fixture resolvable.
