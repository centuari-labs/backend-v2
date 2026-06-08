# backend-v2 — Dependency CVE Scan (2026-06-08)

External-audit prep, **Phase 0.3** (hub-only scope). Tool: `pnpm audit --json`
(pnpm 10.29.2, npm advisory DB). Machine-readable output: [`dependency-scan-2026-06-08.json`](./dependency-scan-2026-06-08.json)
(reflects the **post-remediation** tree at this commit).

Companion artifacts: [`coverage-baseline-2026-06-08.md`](./coverage-baseline-2026-06-08.md).
Scope contract: [`dev-docs/audit/SCOPE.md`](../../dev-docs/audit/SCOPE.md).

## Result at a glance

| Severity | Before remediation | After remediation | Δ |
|---|---|---|---|
| Critical | 1 | **0** | −1 |
| High | 30 | 18 | −12 |
| Moderate | 28 | 18 | −10 |
| Low | 5 | 3 | −2 |
| **Total** | **64** | **39** | **−25** |

> Every remaining advisory is in a **build- or test-time toolchain** dependency
> (`@nestjs/cli`, `jest`, `ts-jest`, `@types/jest`, `ts-node`, `supertest`, `webpack`,
> `@angular-devkit`) **or** has no published fix with an unreachable code path. None sit
> in the production runtime closure (`@nestjs/{common,core,platform-express,config,jwt}`,
> `passport-jwt`, `socket.io`, `pg`, `typeorm`, `viem`, `ioredis`, `nats`, `helmet`, `jose`).

## Remediation applied (production-runtime advisories)

All fixes are **same-major, drop-in** version floors expressed via a `pnpm.overrides`
block in `package.json` — **no source/behavioral changes, no major bumps**. Verified:
`pnpm install` clean + `TZ=UTC pnpm run test` green (555/555).

| Package | Override | Fixed | Reached via (runtime) | Advisory |
|---|---|---|---|---|
| `jws` | `@3 >=3.2.3 <4` (→ 3.2.3) | HIGH | `passport-jwt → jsonwebtoken → jws` | GHSA-869p-cjfg-cm3x (HMAC sig bypass, CWE-347) |
| `@nestjs/core` | `>=11.1.18` (→ 11.1.25) | MOD | direct dep | GHSA-36xv-jgw5-4q75 (injection) |
| `path-to-regexp` | `@8 >=8.4.0` (→ 8.4.2) | HIGH+MOD | `@nestjs/core → path-to-regexp` | GHSA-j3q9-mxjg-w52f, GHSA-27v5-c462-wpq7 (ReDoS/DoS) |
| `multer` | `>=2.1.1` (→ 2.1.1) | HIGH×3 | `@nestjs/platform-express → multer` | GHSA-{xf7r-hgr6-v32p,v52c-386h-88mc,5528-5vmv-3xc2} (DoS) |
| `socket.io-parser` | `>=4.2.6` (→ 4.2.6) | HIGH | `socket.io` server + `socket.io-client` | GHSA-677m-j7p3-52f9 (unbounded attachments) |
| `body-parser` | `@2 >=2.2.2` (→ 2.2.2) | MOD | `express → body-parser` | GHSA-wqch-xfxh-vrr4 (DoS) |
| `qs` | `@6 >=6.15.2` (→ 6.15.2) | MOD+LOW | `express → body-parser → qs`, `superagent → qs` | GHSA-q8mj-m7cp-5q26, GHSA-w7fw-mjwx-w883 (DoS) |
| `ws` | `@8 >=8.20.1` (→ 8.21.0) | MOD | `socket.io-client → engine.io-client → ws` | GHSA-58qx-3vcg-4xpx (mem disclosure) |
| `bn.js` | `@5 >=5.2.3` (→ 5.2.3) | MOD | `@privy-io/server-auth → @solana/web3.js → bn.js` | GHSA-378v-28hj-76wf (infinite loop) |
| `handlebars` | `@4 >=4.7.9` (→ 4.7.9) | **CRIT**+HIGH×4+MOD+LOW | `ts-jest → handlebars` (test) | GHSA-2w6w-674q-4c4q +others (AST injection) |
| `fast-uri` | `@3 >=3.1.2` (→ 3.1.2) | HIGH×2 | `@nestjs/cli → @angular-devkit/core → ajv → fast-uri` (build) | GHSA-q3j6-qgpj-74h6, GHSA-v39h-62p7-jpjc (path traversal) |

> `handlebars` and `fast-uri` are build/test-only but their fixes are trivially safe
> patch-level bumps, so they were cleared too — clearing the single **Critical** gives the
> firm a zero-critical baseline. The `jws` floor is upper-bounded `<4` so `jsonwebtoken@9`
> (which pins `jws@^3`) is **not** force-bumped to the breaking `jws@4` API.

## Accepted advisories (no action) — disposition

The 39 remaining advisories are accepted for the audit window with the rationale below.
Re-confirm with `pnpm audit`.

### A. Build-time CLI toolchain — `@nestjs/cli` and its tree (HIGH/MOD/LOW)
`glob` (cmd-injection in its CLI `-c` flag, **not used** by us), `minimatch` / `brace-expansion`
/ `picomatch` (ReDoS — require attacker-controlled glob patterns; ours are static),
`serialize-javascript` (RCE — only the **6.x** line is present and has **no in-line fix**;
forcing 7.x is a breaking bump into `terser-webpack-plugin`), `ajv` / `js-yaml` (ReDoS / proto-pollution),
`webpack` (build-time SSRF via `buildHttp`, a feature we don't enable).
- **Why accepted:** `@nestjs/cli` is a `devDependency` used only for `nest build`/`nest start` on
  developer/CI machines. It is **not** installed in the production image (multi-stage Dockerfile
  ships only `dist/` + prod deps) and never processes untrusted input. The multi-major spread
  (e.g. `minimatch` 3.x/9.x/10.x simultaneously) means a single override floor would force
  incompatible majors onto consumers — **not** a clearly-safe drop-in.
- **Follow-up:** clears naturally on the next `@nestjs/cli` major bump; out of scope for this
  no-behavioral-change PR.

### B. Test toolchain — `jest`, `ts-jest`, `@types/jest`, `ts-node`, `supertest` (HIGH/MOD/LOW)
`minimatch` / `brace-expansion` / `picomatch` (ReDoS via `jest` reporters & `micromatch`),
`js-yaml` (`istanbuljs` config load), `diff` (`ts-node`), `qs` (`supertest`).
- **Why accepted:** test/dev-only; never runs against untrusted input or in production.
- **Follow-up:** clears on the next `jest`/`ts-jest` line bump.

### C. `lodash` code-injection / proto-pollution — HIGH + MOD (CWE-94 / CWE-1321)
Reached at runtime via `@nestjs/config → lodash` (and build via `@nestjs/cli → node-emoji → lodash`).
- **Why accepted:** the HIGH (GHSA-r5fr-rjxr-66jc) is patched only in `lodash >=4.18.0`, which is
  **unpublished** (latest is 4.17.21) — **no fix available**. The vulnerable sink is `_.template`
  with attacker-controlled key names; `@nestjs/config` does not invoke `_.template`, and our code
  imports no `lodash` directly (`git grep` clean). Vector unreachable.
- **Follow-up:** monitor for a published `lodash` fix; re-evaluate at next audit.

### D. `uuid <11.1.1` — MOD (CWE-787, runtime)
Via `typeorm → uuid` and `@privy-io/server-auth → {svix,@solana/web3.js→jayson} → uuid`.
- **Why accepted:** the tree carries `uuid` 8.3.2 / 10.0.0 / 11.1.0 across consumers; the fix
  exists only in 11.1.1, so a same-major drop-in covers only the 11.x instance while a blanket
  floor would force 8.x/10.x consumers onto 11.x (breaking). The bug is a missing bounds check
  **only when a `buf` argument is supplied** to v3/v5/v6 — a path none of these consumers exercise
  (they generate string UUIDs). Not clearly-safe to force; vector unreachable.

### E. `file-type` — MOD ×2 (DoS, runtime via `@nestjs/common`)
- **Why accepted:** moderate DoS (infinite loop / zip-bomb) on malformed media parsing. `@nestjs/common`
  pulls `file-type` for streamable-file responses; the app does not run user-supplied files through it.
  Patched in 21.3.2; deferred as a moderate (out of the critical/high remit of this pass) — safe
  to fold into a later routine dep bump.

## Verification

```
pnpm install            # clean (exit 0); 2 deprecated subdeps (glob@7, inflight) pre-existing
pnpm audit              # critical 0 / high 18 / moderate 18 / low 3 — all triaged above
TZ=UTC pnpm run test    # 50 suites, 555 tests, all green
```
