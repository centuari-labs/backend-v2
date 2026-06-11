---
title: "fix: Rate Limit Wallet Tracker + On-Chain Throttles (PR-1 Revisi)"
type: fix
status: active
date: 2026-06-11
origin: docs/claude/brainstorms/2026-06-11-rate-limit-rework-requirements.md
---

# fix: Rate Limit Wallet Tracker + On-Chain Throttles (PR-1 Revisi)

## Overview

Memperbaiki akar masalah rate limiting backend: `WalletThrottlerGuard` yang
terdaftar sebagai `APP_GUARD` berjalan sebelum `AuthGuard` level-route,
sehingga `req.user` selalu kosong saat `getTracker()` dievaluasi dan semua
throttle "per-wallet" diam-diam berjalan per-IP. Solusi: **resolver
verifikasi dua tahap yang dibagi** oleh throttler guard dan `AuthGuard` —
tahap murah (verifikasi JWT lokal → `userId`) untuk kunci bucket throttle,
tahap penuh (resolusi wallet via API Privy) hanya di jalur `AuthGuard`,
dengan memoisasi per-request supaya tidak ada verifikasi ganda.

Sekaligus menutup gap P0 tersisa (throttle ketat `repay` +
`withdraw-lend-position`), menghapus guard ganda di `redeem-access-code`
(sah setelah tracker fix), dan mengoreksi tiga dokumen yang memuat klaim
yang tidak akurat.

Branch: baru dari `staging` (usulan nama: `fix/rate-limit-wallet-tracker`).
Menggantikan branch lama `fix/throttle-on-chain-paths` yang ditinggalkan.

---

## Problem Frame

Lihat origin doc untuk kronologi lengkap. Ringkas: audit Juni 2026 → plan
6-PR → PR #114 memasang `APP_GUARD` dengan premis tracker per-wallet yang
ternyata tidak pernah berfungsi (urutan guard) → draft PR-1 lama justru
menghapus satu-satunya konfigurasi per-wallet yang benar. Pekerjaan diulang
dari `staging` dengan pendekatan yang dipilih bersama: token-verifying
tracker di guard global, tanpa guard yang dipasang per-route.

---

## Requirements Trace

Dari origin (R-ID dipertahankan):

- R1. Tracker guard global memverifikasi token sendiri; token valid →
  bucket per identitas terverifikasi; selain itu fallback `req.ip`.
  **Amandemen planning (disetujui user):** kunci bucket = `userId` Privy
  (hasil verifikasi JWT lokal), bukan `walletAddress` — menghindari network
  call `getUser()` per request di tracker. Per-user ≈ per-wallet untuk
  tujuan throttling, dan selaras dengan composite tracker PR-5.
  Entri ini **menggantikan** origin R1: semua implementasi memakai
  `userId`, bukan `walletAddress` (keputusan user 2026-06-11).
- R2. Verifikasi maksimal 1× per request — via resolver bersama dengan
  memoisasi per-request (keputusan user: bukan cek `req.user` / flag).
  Mekanisme memo-Symbol ini **menggantikan** kalimat origin R2 ("disimpan
  ke `request.user`"); `request.user` tetap hanya diset oleh `AuthGuard`.
- R3. Kegagalan verifikasi di tracker tidak menolak request; hanya
  menentukan kunci bucket (penolakan tetap tugas `AuthGuard`).
- R4. `@Throttle` ketat 1/1s + 5/60s di `POST /portfolio/repay` dan
  `POST /portfolio/withdraw-lend-position`.
- R5. Hapus `WalletThrottlerGuard` dari `/auth/redeem-access-code` —
  urutan commit: WAJIB setelah R1/R2 landing.
- R6. Koreksi komentar `src/app.module.ts` (dan komentar "per IP" yang
  menyesatkan di withdraw/faucet controller).
- R7. Koreksi dokumen plan 6-PR + (keputusan user) `dev-docs/architecture.md`
  dan `CLAUDE.md` Auth Flow di PR yang sama, commit terpisah.
- R8. Unit test resolusi tracker (token valid / tanpa token / token invalid
  / dev token).
- R9. Suite test yang ada tetap hijau; `src/__test__/auth/auth.controller.test.ts`
  disesuaikan dengan R5.

**Origin acceptance examples:** AE1 (covers R1, R4), AE2 (covers R1),
AE3 (covers R3), AE4 (covers R2). Catatan AE4: jalur sukses (verifikasi
1×) dibuktikan di test integrasi U3; jalur gagal-memo (token invalid
hanya dicoba 1×) dibuktikan di skenario unit U1.

---

## Scope Boundaries

Dicarry dari origin, tidak berubah:

- `trust proxy` + verifikasi penerusan `X-Forwarded-For` di Next route
  handler → PR-2. Sampai PR-2 landing, bucket IP (request tanpa token)
  masih kolaps di belakang proxy — diterima; jalur ber-token sudah benar
  per identitas setelah PR ini.
- Limiter Redis atomik → PR-2. Rate limit WebSocket → PR-3. Tuning budget →
  PR-4. Composite tracker + storage Redis → PR-5. Observability → PR-6.
- Cache lintas-request token→AuthUser: **secara eksplisit tidak dibangun
  di PR ini** (keputusan user memilih resolver 2 tahap, bukan cache TTL).
  Kandidat PR-5/PR-6 jika beban `getUser()` jadi masalah.
- Throttle faucet: tidak diubah (sudah ada; hanya koreksi status dokumen).

---

## Context & Research

### Relevant Code and Patterns

- `src/common/guards/wallet-throttler.guard.ts` — 9 baris, `getTracker`
  mengembalikan `req.user?.walletAddress ?? req.ip`; tanpa constructor
  sendiri.
- `src/common/guards/auth.guard.ts` — verifikasi via
  `AuthStrategyFactory.getStrategy(token).validate(token)`; error apa pun
  → `UnauthorizedException` generik (sengaja non-leaky, pertahankan).
- `src/common/guards/strategies/` — `AuthStrategyFactory` (membaca
  `ENABLE_DEV_AUTH` di constructor, `new DevAuthStrategy()` sendiri — bukan
  DI), `PrivyAuthStrategy` (validate = `privyService.verify()` lokal +
  `privyService.getUser()` **network call**, fail-closed tanpa wallet),
  `DevAuthStrategy` (lokal, throw di production), `auth-strategy.interface.ts`
  (`AuthUser`, `IAuthStrategy`).
- DI topology: `CoreModule` menyediakan & meng-export `AuthGuard`,
  `AuthStrategyFactory`, `PrivyAuthStrategy`, `PrivyService`; `AppModule`
  meng-import `CoreModule` dan mendaftarkan
  `{ provide: APP_GUARD, useClass: WalletThrottlerGuard }` → injeksi
  dependency baru ke guard global **resolve tanpa perubahan module**.
- `@nestjs/throttler` 6.5.0: `getTracker` sudah `Promise<string>`;
  `ThrottlerModule` `@Global()`. Begitu `WalletThrottlerGuard` punya
  constructor sendiri, wajib meneruskan 3 dependency `ThrottlerGuard` via
  `super()`: options (`@InjectThrottlerOptions()`), storage
  (`@InjectThrottlerStorage()`), `Reflector`.
- Konvensi `@Throttle`: bentuk objek named (`short`/`long`) + komentar
  threat-model singkat di atas decorator — ikuti untuk R4.
- Pola test: metadata-reflection untuk wiring decorator
  (`src/__test__/auth/auth.controller.test.ts`), DI-module + mock factory
  untuk perilaku guard (`src/__test__/common/guards/auth.guard.test.ts`),
  `jest.mock("jose")` + mock `PrivyService` untuk memutus rantai ESM jose.
  Belum ada `wallet-throttler.guard.test.ts` — dibuat di PR ini.
- Integration test (`pnpm run test:integration`) adalah DI-level dengan
  mock eksternal — tidak butuh Redis/Postgres hidup.

### Institutional Learnings

- Tidak ada `docs/solutions/` di repo mana pun. Pelajaran serupa di
  `dev-docs/memory/MEMORY.md` (kasus M-1 matching-engine): guard yang
  menembak di titik eksekusi yang salah diam-diam tidak melindungi —
  pelajarannya: **test harus mengasersikan penempatan/urutan guard, bukan
  hanya logikanya**. Diadopsi di skenario test U2/U3.
- `dev-docs/architecture.md` mencatat rate-limit API eksternal free-tier
  sebagai failure mode historis (429 CoinGecko) — memperkuat keputusan
  tidak menambah panggilan API Privy di tracker.

### External References

- Tidak dipakai — pola lokal kuat dan semantik `@nestjs/throttler` 6.5.0
  terverifikasi langsung dari `node_modules` d.ts.

---

## Key Technical Decisions

- **Resolver 2 tahap, kunci tracker = `userId`** (keputusan user): tahap
  `verifyPrincipal` (JWT lokal) untuk throttle, tahap `validate` penuh
  (dengan `getUser` network call) hanya saat `AuthGuard` membutuhkannya.
  Nol panggilan API tambahan vs hari ini, nol staleness, tanpa komponen
  cache baru.
- **Resolver bersama + memo per-request via Symbol key** (keputusan user):
  satu code path verifikasi untuk kedua guard; hasil sukses MAUPUN gagal
  di-memo supaya token invalid tidak diverifikasi dua kali.
- **Dev token lewat jalur factory yang sama** (keputusan user): tracker
  tidak punya cabang khusus dev; `AuthStrategyFactory` sudah menanganinya.
  Bonus: test integrasi bisa menguji bucket per-user dengan dev token.
- **Prefix kunci tracker `user:` / `ip:`**: justifikasi utama adalah
  pemisahan namespace dan keterbacaan kunci bucket saat debugging storage
  throttler — berlaku sekarang, biaya nol. Bonus sekunder: label
  `tracker_type` metrik PR-6 kelak terbaca dari prefix tanpa perubahan
  kunci.
- **Revisi docs di PR yang sama, commit terpisah** (keputusan user).
- **Tidak ada guard yang dipasang per-route** — sesuai keputusan brainstorm
  (menolak hybrid karena double-counting; menolak AuthGuard-global karena
  refactor `@Public()` menyentuh semua controller dan menempatkan auth
  sebelum rate limit).

---

## Open Questions

### Resolved During Planning

- Mekanisme R2: resolver bersama + memo per-request (Symbol), bukan cek
  kehadiran `req.user` / flag.
- Biaya verifikasi: resolver 2 tahap; tracker tidak pernah memanggil
  `getUser()`.
- `DevAuthStrategy`: jalur factory yang sama.
- Penempatan revisi docs: PR sama, commit terpisah; cakupan diperluas ke
  `dev-docs/architecture.md` dan `CLAUDE.md` Auth Flow.

### Deferred to Implementation

- Nama class resolver (mis. `RequestAuthService`) — diputuskan saat
  implementasi mengikuti gaya repo. Nama dan semantik method sudah FINAL:
  `getPrincipal` (tahap-1) dan `getAuthUser` (tahap-2), sesuai diagram
  High-Level Technical Design.
- Apakah `IAuthStrategy` diperluas dengan `verifyPrincipal()` atau resolver
  melakukan dispatch per-strategy — keduanya valid; pilih yang
  menghasilkan diff paling kecil tanpa duplikasi.
- Test e2e dev-token bergantung `ENABLE_DEV_AUTH` di environment shell
  (inkonsistensi yang sudah ada). Jika suite merah saat verifikasi, perbaiki
  seperlunya dalam scope R9 — jangan refactor lebih luas dari itu.

---

## High-Level Technical Design

> *Ilustrasi arah pendekatan untuk review — bukan spesifikasi implementasi.
> Agent pengimplementasi memperlakukannya sebagai konteks, bukan kode.*

```
                         ┌────────────────────────────────────┐
 request ──────────────► │ WalletThrottlerGuard (APP_GUARD)   │
                         │  principal = resolver.getPrincipal │──┐
                         │  tracker = principal               │  │ memo di
                         │     ? `user:${userId}`             │  │ request
                         │     : `ip:${req.ip}`               │  │ (Symbol)
                         └────────────────────────────────────┘  │
                                      ... route guards ...       │
                         ┌────────────────────────────────────┐  │
                         │ AuthGuard (route-level)            │◄─┘
                         │  user = resolver.getAuthUser       │
                         │  (validate penuh, getUser 1×,      │
                         │   memo; gagal → 401 generik)       │
                         └────────────────────────────────────┘

 resolver.getPrincipal: verifikasi murah (JWT lokal) → { userId } | null
                        TIDAK PERNAH throw; gagal di-memo sebagai null.
 resolver.getAuthUser : strategy.validate(token) penuh → AuthUser; throw
                        UnauthorizedException; hasil & kegagalan di-memo.
```

---

## Implementation Units

Urutan unit = urutan commit (working agreement: tiap commit hijau sendiri).

- U1. **Resolver verifikasi bersama dua tahap**

**Goal:** Satu code path verifikasi token yang di-memo per-request, dipakai
throttler guard (tahap murah) dan `AuthGuard` (tahap penuh).

**Requirements:** R1, R2, R3 (fondasi); AE3, AE4.

**Dependencies:** None.

**Files:**
- Create: `src/common/guards/strategies/request-auth.service.ts` (nama
  final boleh disesuaikan gaya repo)
- Modify: `src/core/core.module.ts` (provide + export)
- Modify (jika diperlukan): `src/common/guards/strategies/auth-strategy.interface.ts`,
  `privy-auth.strategy.ts`, `dev-auth.strategy.ts` (pemisahan tahap
  verifikasi murah)
- Test: `src/__test__/common/guards/strategies/request-auth.service.test.ts`

**Approach:**
- Dua API: tahap-1 principal (verifikasi JWT lokal — untuk Privy hanya
  `privyService.verify()`; untuk dev token `validate()` lokal penuh),
  tahap-2 AuthUser (validate penuh, satu-satunya tempat `getUser()`
  terpanggil).
- Memoisasi pada object request via `Symbol` unik — sukses dan gagal
  sama-sama di-memo (token invalid hanya dicoba 1×).
- Tahap-1 tidak pernah throw (CLAUDE.md rule 15 untuk logging error);
  tahap-2 mempertahankan kontrak `UnauthorizedException` generik milik
  `AuthGuard` hari ini.
- Tidak menduplikasi logika strategy — resolver hanya orkestrasi + memo.
- `PrivyService.verify` meneruskan verification key lokal yang sudah
  dimuat sebagai override (`verifyAuthToken(token, key)`) saat
  `keys/verificationKeyPrivy.key.pub` tersedia, plus pre-warm fetch key
  sekali di `onModuleInit` sebagai fallback — tahap-1 benar-benar lokal
  pada steady state (SDK TIDAK meng-cache fetch key yang gagal).
- Pre-check murah sebelum kripto: nilai Authorization yang tidak berpola
  JWT tiga-segmen base64url atau > 4096 karakter → principal null
  (fallback IP) tanpa memanggil `privyService.verify()`.

**Patterns to follow:**
- `AuthStrategyFactory` untuk pemilihan strategy (jangan bikin dispatch
  paralel).
- Pola mock `jest.mock("jose")` + mock `PrivyService` dari
  `auth.guard.test.ts`.

**Test scenarios:**
- Happy path: token Privy valid → principal `{userId}`; `verify` terpanggil
  tepat 1× walau `getPrincipal` dipanggil 2× (memo).
- Covers AE4. Happy path: `getPrincipal` lalu `getAuthUser` pada request
  yang sama → `validate`/`getUser` total 1× (asersi call-count mock).
- Edge case: tanpa Authorization header → principal null, tanpa throw.
- Error path: token invalid → principal null, di-memo (verify 1× saja),
  tanpa throw. Covers AE3.
- Happy path: dev token (factory dengan `ENABLE_DEV_AUTH`) → principal
  `dev-user-<addr>`.
- Error path: `getAuthUser` dengan token tanpa linked wallet → throw
  `UnauthorizedException` (kontrak fail-closed PrivyAuthStrategy utuh).
- Error path: header berpola bukan-JWT atau token > 4096 karakter →
  principal null TANPA pemanggilan `verify` (asersi mock tidak terpanggil).

**Verification:** Unit test U1 hijau; tidak ada perubahan perilaku publik
(belum ada pemanggil baru).

---

- U2. **Tracker per-identitas di `WalletThrottlerGuard`**

**Goal:** Bucket throttle global benar-benar per identitas terverifikasi.

**Requirements:** R1, R3, R8; AE1, AE2, AE3.

**Dependencies:** U1.

**Files:**
- Modify: `src/common/guards/wallet-throttler.guard.ts`
- Test: `src/__test__/common/guards/wallet-throttler.guard.test.ts` (baru)

**Approach:**
- Tambah constructor yang `super()` tiga dependency `ThrottlerGuard`
  (`@InjectThrottlerOptions()`, `@InjectThrottlerStorage()`, `Reflector`)
  plus resolver U1.
- `getTracker`: principal → `user:${userId}`, selain itu `ip:${req.ip}`.
- Tidak pernah throw dari `getTracker` (fallback IP + log sesuai rule 15).
- Catatan jendela antar-commit: sejak U2 landing sampai U5,
  `redeem-access-code` dihitung DUA KALI (guard global + route-level
  menghasilkan kunci identik → budget efektif setengah). Diterima karena
  seluruh commit landing dalam satu PR dan tidak di-deploy terpisah;
  jendela bisa disusutkan dengan urutan commit U1 → U4 → U2 → U3 → U5.

**Patterns to follow:** Pelajaran M-1 (MEMORY.md): uji penempatan/urutan,
bukan hanya logika — sertakan test bahwa tracker resolve wallet **pada
route tanpa AuthGuard sama sekali** (kasus yang dulu regresi diam-diam).

**Test scenarios:**
- Covers AE1/AE2 (level unit): token valid → `user:<userId>`; dua token
  user berbeda → kunci berbeda; user sama beda IP → kunci sama.
- Edge case: tanpa token → `ip:<req.ip>`.
- Error path: token invalid / resolver error → `ip:<req.ip>`, tanpa throw.
  Covers AE3.
- Happy path: dev token → `user:dev-user-<addr>`.
- Integration: route publik (tanpa `AuthGuard`) dengan token valid →
  tracker tetap `user:` (asersi via guard yang dipasang di test module).

**Verification:** Unit + integration test hijau; `pnpm run test` penuh
tetap hijau.

---

- U3. **`AuthGuard` memakai resolver (verifikasi tunggal per request)**

**Goal:** Hilangkan verifikasi ganda; `AuthGuard` jadi konsumen tahap-2
resolver tanpa perubahan kontrak eksternal.

**Requirements:** R2; AE4.

**Dependencies:** U1.

**Files:**
- Modify: `src/common/guards/auth.guard.ts`
- Test: `src/__test__/common/guards/auth.guard.test.ts` (update),
  `src/__test__/integration/auth-flow.integration.test.ts` (cek tetap
  hijau; ada asersi lama "factory always returns PrivyAuthStrategy" yang
  berpotensi stale — sesuaikan hanya jika pecah)

**Approach:**
- `canActivate`: validasi format header tetap di guard; verifikasi via
  `resolver.getAuthUser(request)`; set `request.user`; pesan 401 generik
  dipertahankan persis.

**Test scenarios:**
- Covers AE4. Integration: throttler guard + AuthGuard pada request yang
  sama → `PrivyService.verify` dan `getUser` masing-masing tepat 1×.
- Error path: tanpa header / format salah / token invalid → 401 dengan
  pesan generik yang sama seperti sekarang (tidak ada regresi pesan).
- Happy path: token valid → `request.user` berisi `{userId, walletAddress}`.

**Verification:** Seluruh suite unit + integration hijau.

---

- U4. **Throttle ketat jalur on-chain portfolio**

**Goal:** Tutup gap P0: `repay` dan `withdraw-lend-position` setara
`/withdraw`.

**Requirements:** R4; AE1.

**Dependencies:** Tidak ada dependensi Git/file (bisa di-commit kapan pun
sebelum U6), tapi secara FUNGSIONAL bergantung U1–U3 — sampai tracker fix
landing, throttle ini efektif per-IP. Wajib landing dalam PR yang sama;
skenario integrasi 429 di bawah baru bisa ditulis setelah U2.

**Files:**
- Modify: `src/portfolio/portfolio.controller.ts`
- Test: `src/__test__/portfolio/portfolio.controller.test.ts` (tambah
  asersi metadata throttle, mirror pola `auth.controller.test.ts`)

**Approach:** `@Throttle({ short: { ttl: 1000, limit: 1 }, long:
{ ttl: 60_000, limit: 5 } })` + komentar threat-model singkat (operator
drain), konsisten gaya `/withdraw`.

**Test scenarios:**
- Happy path: metadata `@Throttle` ter-set di kedua handler dengan nilai
  1/1s + 5/60s (reflection test).
- Covers AE1. Integration: `canActivate` guard dijalankan dua kali
  terhadap konteks handler `repay` nyata (Reflector asli membaca metadata
  `@Throttle` controller, token valid sama) → panggilan kedua melempar
  `ThrottlerException` (429).
- Covers AE2. Integration: dua token user berbeda dari IP sama pada
  handler yang sama → keduanya lolos.

**Verification:** Reflection test hijau.

---

- U5. **Hapus guard ganda `redeem-access-code` + bersihkan provider mati**

**Goal:** Setelah tracker benar (U1–U3), guard route-level dan provider
binding `WalletThrottlerGuard` di AuthModule menjadi redundan sungguhan.

**Requirements:** R5, R9.

**Dependencies:** U1, U2, U3 — ketiganya WAJIB di-commit lebih dulu; U5
hanya di-commit setelah ketiganya hijau.

**Files:**
- Modify: `src/auth/auth.controller.ts` (hapus dari `@UseGuards`),
  `src/auth/auth.module.ts` (hapus provider + import mati)
- Test: `src/__test__/auth/auth.controller.test.ts` (ekspektasi jadi
  `[AuthGuard]`, dengan komentar alasan merujuk tracker fix)

**Approach:**
- Grep `WalletThrottlerGuard` memastikan tidak ada situs route-level lain
  (sudah diverifikasi saat riset: hanya satu).
- Audit `src/core/privy/privy.guard.ts` — penulis `req.user` pesaing
  dengan shape berbeda (raw Privy claims, bukan `AuthUser`): grep
  pemakaian `PrivyGuard`; jika tak terpakai (kondisi saat riset), HAPUS
  filenya; jika ternyata dipakai, tambahkan JSDoc peringatan agar tidak
  dikomposisikan dengan `AuthGuard`/resolver pada route yang sama.

**Test scenarios:**
- Happy path: metadata guards `redeemAccessCode` = `[AuthGuard]`.
- Integration: request ke `redeem-access-code` tetap ter-throttle oleh
  guard global dengan kunci `user:` (bukan lolos tanpa throttle).

**Verification:** Suite hijau; tidak ada referensi `WalletThrottlerGuard`
tersisa di luar `app.module.ts` dan file guard-nya; `PrivyGuard` terhapus
atau teranotasi peringatan.

---

- U6. **Koreksi komentar dan dokumen (commit docs terpisah, PR sama)**

**Goal:** Tidak ada klaim arsitektur yang salah tersisa di kode/dokumen.

**Requirements:** R6, R7.

**Dependencies:** U1–U5 (commit terakhir).

**Files:**
- Modify: `src/app.module.ts` (komentar APP_GUARD → deskripsi mekanisme
  resolver + fallback IP),
  `src/withdraw/withdraw.controller.ts` + `src/faucet/faucet.controller.ts`
  (komentar "per IP" → per identitas/per-user),
  `docs/claude/plans/2026-06-05-fix-rate-limit-audit-implementation-plan.md`
  (TULIS ULANG seksi PR-1 [±baris 89–124]: premis "double-throttle bug"
  dikoreksi — guard ganda adalah satu-satunya konfigurasi per-wallet yang
  bekerja saat itu, penghapusannya sah hanya setelah tracker fix; baris
  status P0 #3a diperbarui merujuk plan ini sebagai pengganti PR-1 lama;
  status P0 #1 faucet "Skipped" → sudah ter-throttle via `978e577`),
  `dev-docs/architecture.md` (perbarui langkah Auth flow sekitar baris
  775: deskripsikan skema dua tahap — tracker global memperoleh kunci
  bucket dari verifikasi JWT lokal; `AuthGuard` melakukan validasi penuh
  termasuk `getUser` dan TETAP satu-satunya penyetel `request.user`),
  `CLAUDE.md` (bagian Auth Flow: tambahkan bahwa `WalletThrottlerGuard`
  [APP_GUARD] memanggil resolver tahap-1 untuk kunci bucket; `AuthGuard`
  memanggil resolver tahap-2 [validate penuh + `getUser`, memoized] dan
  tetap satu-satunya penyetel `request.user`).
- Test: Test expectation: none — perubahan komentar/dokumen tanpa perilaku.

**Verification:** `pnpm run lint` hijau; review manual diff docs.

---

## System-Wide Impact

- **Interaction graph:** Semua route HTTP terdampak kunci bucket-nya:
  request ber-token valid → `user:<userId>` (termasuk route publik —
  perubahan perilaku kecil yang diinginkan); tanpa token → `ip:<ip>`.
  WebSocket gateway tidak tersentuh (punya jalur dev-token inline sendiri;
  rate limit WS = PR-3).
- **Error propagation:** Kegagalan verifikasi di tracker diserap (fallback
  IP); kegagalan di `AuthGuard` tetap 401 generik — tidak ada pesan error
  baru ke klien.
- **State lifecycle risks:** Memo per-request berumur sependek request;
  tidak ada cache lintas-request → tidak ada staleness baru. Throttler
  storage tetap in-memory (single-instance; Redis = PR-5).
- **API surface parity:** Tidak ada perubahan kontrak respons. Budget
  default tidak berubah; hanya kunci bucket yang membaik.
- **Integration coverage:** Skenario "route tanpa AuthGuard tetap dapat
  kunci `user:`" dan "verify+getUser tepat 1× per request" adalah dua
  perilaku lintas-guard yang unit test murni tidak buktikan — keduanya
  diwajibkan di U2/U3.
- **Unchanged invariants:** Kontrak `IAuthStrategy.validate` dan perilaku
  fail-closed PrivyAuthStrategy (tanpa wallet → 401) tidak berubah; urutan
  guard NestJS tidak diutak-atik — solusi bekerja DI DALAM urutan yang ada.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Salah wiring `super()` dependency `ThrottlerGuard` → guard global mati total | Unit test U2 menginstansiasi guard via DI module test; smoke `pnpm run test:integration` |
| Fetch verification key Privy gagal saat cold start: SDK TIDAK meng-cache kegagalan — retry network per request di semua route | U1: key file lokal sebagai override `verifyAuthToken` + pre-warm di `onModuleInit`; tanpa itu, degradasi Privy menambah latensi semua route dan fallback IP (pra-PR-2, di belakang proxy) menggabungkan trafik ber-token ke satu bucket |
| Flood token-sampah memaksa kripto JWT per request sebelum throttle | Pre-check murah di `getPrincipal` (pola JWT 3-segmen + batas 4096 char) membuat input non-JWT gagal tanpa kripto; sisanya biaya lokal kecil, bucket IP tetap menghitung |
| Asersi stale di `auth-flow.integration.test.ts` ("always returns PrivyAuthStrategy") pecah saat refactor | Scope R9: perbaiki asersi seperlunya, jangan refactor suite |
| e2e dev-token bergantung `ENABLE_DEV_AUTH` di shell env | Jika merah saat verifikasi, set env di konfigurasi test e2e (perbaikan minimal) |
| Sampai PR-2 (`trust proxy`), bucket `ip:` masih kolaps di belakang proxy Next | Diketahui & diterima di scope; jalur ber-token sudah benar setelah PR ini |

---

## Documentation / Operational Notes

- Setelah merge, kandidat kuat `/ce-compound`: (1) pitfall APP_GUARD vs
  route-guard ordering; (2) keputusan biaya verifikasi Privy (verify lokal
  vs getUser network).
- Verifikasi sesuai working agreement plan 6-PR: `pnpm run lint`,
  `pnpm run test`, `pnpm run test:integration` hijau sebelum push; commit
  kecil atomik; tanpa force-push; maintainer yang merge.

---

## Sources & References

- **Origin document:** docs/claude/brainstorms/2026-06-11-rate-limit-rework-requirements.md
- Plan yang dikoreksi: docs/claude/plans/2026-06-05-fix-rate-limit-audit-implementation-plan.md
- Kode terkait: `src/common/guards/`, `src/core/privy/privy.service.ts`,
  `src/app.module.ts`, `src/portfolio/portfolio.controller.ts`
- Pelajaran terkait: `dev-docs/memory/MEMORY.md` (M-1 guard-ordering)
