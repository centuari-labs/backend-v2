---
date: 2026-06-11
topic: rate-limit-rework
---

# Rate Limit Rework — PR-1 Revisi (Wallet Tracker + On-Chain Throttles)

## Problem Frame

Audit rate-limit Juni 2026 menghasilkan rencana 6-PR
(`docs/claude/plans/2026-06-05-fix-rate-limit-audit-implementation-plan.md`).
PR #114 mendaftarkan `WalletThrottlerGuard` sebagai `APP_GUARD`, dan draft
PR-1 (branch lama `fix/throttle-on-chain-paths`) menambah throttle ketat pada
dua endpoint on-chain serta menghapus guard "redundant" di
`/auth/redeem-access-code`.

Review ulang (2026-06-11) menemukan bahwa premis pekerjaan itu keliru:

1. **Per-wallet tracking tidak pernah berjalan.** Global guard (`APP_GUARD`)
   dieksekusi *sebelum* `AuthGuard` level-route, sehingga `req.user` selalu
   kosong saat `getTracker()` dievaluasi — semua throttle efektif per-IP.
   Komentar di `src/app.module.ts` yang mengklaim "tracker resolves to the
   authenticated wallet (post-AuthGuard)" tidak benar.
2. **Kolaps di belakang proxy.** Frontend mem-proxy semua panggilan API lewat
   Next.js route handler dan `main.ts` belum mengeset `trust proxy`, sehingga
   per-IP berarti seluruh user berbagi satu bucket. Budget ketat (1/1s) pada
   jalur on-chain menjadi DoS terhadap user yang sah.
3. Guard ganda di `/auth/redeem-access-code` yang oleh draft PR-1 disebut
   "double-throttle bug" justru satu-satunya konfigurasi per-wallet yang
   benar (guard route-level berjalan setelah `AuthGuard`).

Pekerjaan dimulai ulang dari `staging` (basis paling mutakhir). Branch lama
`fix/throttle-on-chain-paths` ditinggalkan; hanya commit `33025be` (throttle
ketat repay + withdraw-lend-position) yang isinya diselamatkan.

---

## Requirements

**Tracker per-wallet (akar masalah)**

- R1. `WalletThrottlerGuard` (global) memverifikasi bearer token sendiri di
  `getTracker()` menggunakan `AuthStrategyFactory` yang sudah ada: token
  valid → tracker = `walletAddress`; tanpa token / token invalid → fallback
  `req.ip`. Tidak ada guard throttle yang dipasang per-route.
- R2. Hasil verifikasi di guard disimpan ke `request.user` sehingga
  `AuthGuard` di route memakai hasil yang sama dan token tidak diverifikasi
  dua kali dalam satu request.
- R3. Kegagalan verifikasi token di tracker TIDAK menolak request (itu tugas
  `AuthGuard`); tracker hanya menentukan kunci bucket.

**Throttle jalur on-chain (gap P0 tersisa)**

- R4. `POST /portfolio/repay` dan `POST /portfolio/withdraw-lend-position`
  diberi `@Throttle` ketat 1/1s + 5/60s, konsisten dengan `/withdraw`
  (konvensi tabel threshold di plan).
- R5. Guard ganda `WalletThrottlerGuard` di `/auth/redeem-access-code`
  dihapus — perubahan ini baru sah SETELAH R1 landing (tanpa R1, guard
  route-level itu adalah satu-satunya per-wallet throttle yang berfungsi).

**Kebenaran dokumentasi**

- R6. Komentar `src/app.module.ts` diperbaiki agar mendeskripsikan mekanisme
  tracker yang sebenarnya (verifikasi token di guard, fallback IP).
- R7. Dokumen plan 6-PR direvisi: (a) koreksi premis "double-throttle bug"
  PR-1 dan urutan dependensinya terhadap fix tracker; (b) koreksi status
  P0 #1 — faucet HTTP sudah ter-throttle 1/1s + 5/60s via `978e577`,
  bukan "Skipped" (bot order-worker tidak terdampak karena memanggil
  `FaucetService` in-process, bukan HTTP).

**Pengujian**

- R8. Unit test resolusi tracker minimal tiga skenario: (a) token valid →
  wallet; (b) tanpa token → IP; (c) token invalid → IP tanpa melempar error.
- R9. Test yang ada (unit + integration) tetap hijau; test lama yang
  mengasersikan guard ganda di redeem-access-code disesuaikan dengan R5.

---

## Acceptance Examples

- AE1. **Covers R1, R4.** Dua request `POST /portfolio/repay` dalam 1 detik
  dari wallet yang sama (token valid, IP berbeda) → request kedua `429`.
- AE2. **Covers R1.** Dua user berbeda (wallet A dan B) di belakang IP proxy
  yang sama, masing-masing 1× `POST /withdraw` dalam detik yang sama →
  keduanya sukses (tidak lagi berbagi bucket IP).
- AE3. **Covers R3.** Request dengan token kedaluwarsa ke route publik
  (mis. `GET /market`) → tetap diproses normal, ter-throttle per-IP.
- AE4. **Covers R2.** Request terautentikasi ke route ber-`AuthGuard` →
  verifikasi Privy hanya terjadi satu kali (dapat diasersikan via mock
  call-count di unit test).

---

## Success Criteria

- Budget "per-wallet" pada tabel konvensi plan benar-benar berlaku per
  wallet di seluruh route terautentikasi — bisa dibuktikan dengan AE1/AE2.
- Operator-drain window di `repay` dan `withdraw-lend-position` tertutup
  (paritas dengan `/withdraw`).
- `/ce-plan` atau implementer bisa langsung mengeksekusi tanpa menemukan
  klaim arsitektur yang salah di komentar kode maupun dokumen plan.

---

## Scope Boundaries

- `trust proxy` + verifikasi penerusan `X-Forwarded-For` di Next route
  handler → tetap di PR-2 (butuh konfirmasi topologi deployment; pertanyaan
  #3 di plan belum terjawab). Catatan: sebelum PR-2 landing, fallback IP
  masih kolaps di belakang proxy — R1 memastikan jalur terautentikasi sudah
  benar lebih dulu.
- Limiter Redis atomik (race INCR→EXPIRE) → PR-2.
- Rate limit WebSocket subscribe → PR-3.
- Tuning budget (cancel/update vs place; flag vs unflag; read endpoints) →
  PR-4.
- Tracker komposit `wallet+privyUserId` dan storage Redis untuk throttler →
  PR-5 (R1 menjadi fondasinya; PR-5 tinggal mengganti format kunci).
- Observability + kebijakan fail-open → PR-6.
- Throttle faucet: tidak diubah (sudah ada di kode; R7 hanya mengoreksi
  status di dokumen).

---

## Key Decisions

- **Token-verifying tracker, bukan hybrid per-route**: hybrid (guard wallet
  dipasang ulang per-route) menghasilkan double-counting (request dihitung
  di bucket IP dan wallet sekaligus) dan dikritik sebagai pola "pasang
  satu-satu padahal sudah global". Verifikasi token di tracker membuat satu
  guard global benar untuk semua route.
- **Bukan AuthGuard global + @Public()**: lebih bersih secara arsitektur
  tapi refactor menyentuh semua controller, dan menempatkan verifikasi auth
  sebelum rate limit (flood tak terautentikasi mengerjakan verifikasi JWT
  tanpa throttle). Ditolak untuk PR ini; bisa dipertimbangkan ulang saat
  PR-5.
- **Branch baru dari `staging`**, bukan melanjutkan
  `fix/throttle-on-chain-paths`: sesuai working agreement plan (branch dari
  staging terbaru), dan branch lama memuat commit yang arahnya dibatalkan
  (`5bd04b7` prematur sebelum tracker fix) plus noise revert
  (`69a8556`/`f7a2e7f`).
- **Struktur 6-PR dipertahankan** dengan isi PR-1 dikoreksi — menghormati
  kesepakatan kerja yang sudah ditegakkan maintainer (revert karena scope).

---

## Dependencies / Assumptions

- `AuthStrategyFactory` + `PrivyAuthStrategy` dapat dipanggil dari guard
  throttler tanpa circular dependency (keduanya hidup di `common/guards/`;
  asumsi wajar, diverifikasi saat implementasi).
- Verifikasi token Privy bersifat lokal/murah (JWT verify), sehingga aman
  dijalankan di tracker untuk setiap request ber-token. Jika ternyata ada
  panggilan jaringan per-verifikasi, R1 perlu cache TTL pendek — putuskan
  saat planning.
- `@nestjs/throttler` mendukung `getTracker()` async (sudah `Promise<string>`
  di implementasi sekarang).

---

## Outstanding Questions

### Deferred to Planning

- [Affects R2][Technical] Mekanisme persis agar `AuthGuard` memakai
  `request.user` hasil guard throttler tanpa melonggarkan jaminan auth
  (mis. flag `request.authVerified` vs cek keberadaan `request.user`).
- [Affects R1][Technical] Perlakuan terhadap `DevAuthStrategy`
  (`ENABLE_DEV_AUTH`) di tracker — ikut jalur factory yang sama atau
  dikecualikan.
- [Affects R7][User decision] Apakah revisi dokumen plan ikut di PR yang
  sama atau dipisah commit-nya (working agreement: commit kecil atomik —
  rekomendasi: commit terpisah di PR yang sama).

---

## Next Steps

-> `/ce-plan` untuk rencana implementasi terstruktur (branch baru dari
`staging`, urutan commit, dan detail teknis R1/R2).
