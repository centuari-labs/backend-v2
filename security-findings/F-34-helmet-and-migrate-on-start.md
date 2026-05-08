# F-34: Missing security headers + `MIGRATIONS_ON_START=true` is dangerous in production

**Severity**: 🟠 High
**OWASP**: A05 Security Misconfiguration, A08 Software and Data Integrity Failures
**CWE**: CWE-693 (Protection Mechanism Failure), CWE-15 (External Control of System or Configuration Setting)

## Summary

Two coupled deployment / configuration weaknesses:

1. **No security response headers.** The bootstrap in `main.ts` does not install `helmet` or any equivalent middleware. The server returns no `Content-Security-Policy`, no `X-Frame-Options`, no `Strict-Transport-Security`, no `X-Content-Type-Options`, no `Referrer-Policy`, no `X-Powered-By` removal.
2. **Auto-run migrations + seeds on every boot.** `main.ts` runs `runMigrations()` and `runSeeds()` if `MIGRATIONS_ON_START=true` / `SEED_ON_START=true`. The committed `.env` has both set to `true`. Any deploy ships those values forward unless explicitly overridden — meaning every container restart in production runs whatever migration files happen to be present, including ones partially merged into a hot-fix branch.

## Evidence

### Missing headers

`src/main.ts:24-46`:

```typescript
const app = await NestFactory.create(AppModule);

app.enableShutdownHooks();

app.enableCors({
    origin: process.env.CORS_ORIGINS?.split(",") || [],
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE"],
});

app.useGlobalInterceptors(new ResponseInterceptor());
app.useGlobalFilters(new AllExceptionsFilter());
app.useGlobalPipes(new ValidationPipe({...}));

app.use(json({ limit: "10kb" }));
app.use(urlencoded({ limit: "10kb", extended: true }));

await app.listen(process.env.PORT ?? 3000);
```

```bash
$ grep -rn "helmet\|X-Frame-Options\|Content-Security-Policy" src --include="*.ts"
# (no results)
```

A request to `/` returns:

```
HTTP/1.1 200 OK
X-Powered-By: Express        ← leaks framework
Content-Type: application/json
... (no CSP, no HSTS, no XCTO)
```

### Auto-run migrations on boot

`src/main.ts:11-19`:

```typescript
async function bootstrap() {
    if (process.env.MIGRATIONS_ON_START === "true") {
        await runMigrations();         // ⚠️ runs every boot
    }

    if (process.env.SEED_ON_START === "true") {
        await runSeeds();              // ⚠️ runs every boot
    }
    ...
}
```

`.env:9-10` (committed):

```
MIGRATIONS_ON_START=true
SEED_ON_START=true
```

`runMigrations` reads every `.sql` file in `src/core/database/migrations/` and applies pending ones in a single `BEGIN/COMMIT` block:

```typescript
// src/core/database/scripts/run-migration.ts:36-46 (excerpt)
console.log(`📄 Running: ${file}`);
await client.query("BEGIN");
await client.query(upPart);
await client.query("INSERT INTO migrations_log (filename) VALUES ($1)", [file]);
await client.query("COMMIT");
```

There's no advisory lock, no leader election, no environment guard.

## Impact

### Header gaps

- **`X-Powered-By: Express`** identifies the framework and version-class to attackers, who can then look up known Express CVEs (note F-12 already flagged a body-parser DoS).
- **No `Strict-Transport-Security`**: a user who hits the API over HTTP once (typo, bookmark, downgrade attempt) doesn't get pinned to HTTPS for future visits.
- **No `Content-Security-Policy`** / `X-Frame-Options`: not directly relevant to a JSON API, but the absence becomes an issue if any HTML/error-page rendering ever lands (Nest can return HTML for crashes; even error JSON in an iframe can be reflected if a CSRF-style trick is layered with another bug).
- **No `X-Content-Type-Options: nosniff`**: an attacker who can plant content into a JSON response (via reflected error message — see F-14) and who serves it under a permissive `Content-Type` may trigger MIME sniffing in some user agents.
- **CORS is `credentials: true` with `process.env.CORS_ORIGINS?.split(",") || []`**: today the empty-array fallback is safe-by-accident (no origin allowed), but if `CORS_ORIGINS=*` is ever set in deployment, the combination with `credentials: true` is the worst-of-both-worlds and browsers will reject it (or, depending on browser bugs, have permitted it historically).

### Migrations-on-start

- **F-34.1 — Multi-replica boot races**: when N replicas restart concurrently (e.g. rolling deploy, autoscaler), all N call `runMigrations()`. The migration script begins a transaction, executes the SQL, inserts into `migrations_log`. Without a lock, two replicas can race on the same migration file. PostgreSQL serializes DDL, but the second replica's tx may fail mid-DDL with a partial schema state and an inconsistent `migrations_log`. Recovery requires manual cleanup.
- **F-34.2 — Half-merged migration deploys**: a feature branch with a destructive migration gets reverted in source but the file remains in the deployed image (perhaps via a rollback that didn't include that file). On next restart, the migration runs against production. There is no safety review between "container has these files" and "DDL touches the table".
- **F-34.3 — Seeds in production**: `SEED_ON_START=true` runs every seed file the team ships, in production, on every restart. Seeds typically include test users, sample markets, etc. If a seed file targets the same `id` as a real production row, the seed's `INSERT … ON CONFLICT DO UPDATE` (or the bare `INSERT` that clashes) overwrites or fails. Either way, production data is at the mercy of dev-time fixtures.
- **F-34.4 — Configuration drift**: the `.env` template ships `MIGRATIONS_ON_START=true`. New environments inherit it. There's no operational distinction between "I want this for dev because it's convenient" and "I want this in prod because my migration story has no other path".
- **F-34.5 — Migration-on-boot turns deploys into untracked DDL events**: an SRE looking at "what changed in production at 14:32" today has to inspect deploy logs *plus* whatever migrations ran during boot. A deploy and a schema change become indistinguishable.

## Recommended Solution

### A. Headers — install helmet

```bash
pnpm add helmet
```

`src/main.ts`:

```typescript
import helmet from "helmet";

const app = await NestFactory.create(AppModule);

app.use(
    helmet({
        // Tweak as needed; defaults are sensible for a JSON API.
        crossOriginResourcePolicy: { policy: "same-site" },
        // CSP for a pure-JSON API is mostly irrelevant; if any HTML is ever returned, set
        // a strict default-src none policy.
        contentSecurityPolicy: false,
    }),
);
app.disable("x-powered-by");
```

Helmet sets:

- `Strict-Transport-Security: max-age=15552000; includeSubDomains`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: SAMEORIGIN`
- `X-DNS-Prefetch-Control: off`
- `Referrer-Policy: no-referrer`
- removes `X-Powered-By`

For an API behind a CDN/proxy, also turn on `app.set("trust proxy", "loopback, linklocal, uniquelocal")` so `req.ip` reflects the real client (also helps F-2 wallet-throttler accuracy).

### B. Migrations — gate by environment, lock during run, run via dedicated job

#### B1. Make `MIGRATIONS_ON_START` opt-in per environment

`src/main.ts`:

```typescript
async function bootstrap() {
    const isProduction = process.env.NODE_ENV === "production";
    const migrateOnStart = process.env.MIGRATIONS_ON_START === "true";

    if (migrateOnStart && isProduction && !process.env.ALLOW_MIGRATIONS_IN_PROD) {
        throw new Error(
            "Refusing to run migrations on production startup. " +
            "Run them as a separate step (CI job, k8s init container, or manual command). " +
            "Override with ALLOW_MIGRATIONS_IN_PROD=1 if you really mean it.",
        );
    }

    if (migrateOnStart) {
        await runMigrations();
    }
    if (process.env.SEED_ON_START === "true") {
        if (isProduction) {
            throw new Error("SEED_ON_START is not allowed when NODE_ENV=production.");
        }
        await runSeeds();
    }
    ...
}
```

Combined with F-32 (NODE_ENV-gated dev auth), the boot path now refuses every dev-only convenience flag in production.

#### B2. Use an advisory lock during migrations

`src/core/database/scripts/run-migration.ts`:

```typescript
const MIGRATION_LOCK_KEY = 0xC0FFEE;

await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
try {
    // existing migration loop
} finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
}
```

Concurrent boots serialize on the same lock; only one replica runs migrations at a time.

#### B3. Move migrations out of the application boot path

The recommended pattern in production is:

1. CI/CD pipeline runs `pnpm run db:migrate` against the production DB **after** image build, **before** rolling out the new image.
2. The application image starts without running migrations.
3. The boot-time toggle remains for development convenience.

K8s example (init container):

```yaml
spec:
  template:
    spec:
      initContainers:
        - name: migrate
          image: backend:${TAG}
          command: ["node", "dist/src/core/database/scripts/run-migration.js"]
          envFrom: [{ secretRef: { name: db-secret } }]
      containers:
        - name: app
          image: backend:${TAG}
          env:
            - { name: MIGRATIONS_ON_START, value: "false" }
            - { name: SEED_ON_START,       value: "false" }
```

### C. Strip dev-only flags from `.env.example`

Per F-1's `.env.example`, the production-relevant defaults should be `MIGRATIONS_ON_START=false`, `SEED_ON_START=false`, and `ENABLE_DEV_AUTH` commented out. The committed defaults shouldn't push operators toward unsafe choices.

```
# Production: leave both at false. Run migrations as a separate CI step.
MIGRATIONS_ON_START=false
SEED_ON_START=false
```

### D. Add an integration test that hits a fresh app and asserts headers

```typescript
// __test__/security/headers.spec.ts
import request from "supertest";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";

it("sets baseline security headers", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    // bootstrap-equivalent middleware:
    app.use(require("helmet")());
    app.disable("x-powered-by");
    await app.init();

    const res = await request(app.getHttpServer()).get("/health");
    expect(res.headers["x-powered-by"]).toBeUndefined();
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["strict-transport-security"]).toBeDefined();
    expect(res.headers["x-frame-options"]).toBeDefined();
    await app.close();
});
```

## Verification

```bash
# 1. Headers
curl -sI http://localhost:8080/me \
    -H "Authorization: Bearer DEV_TOKEN_0x..." | grep -iE "x-powered-by|strict-transport|x-content-type|x-frame"
# Expected: no X-Powered-By; X-Content-Type-Options: nosniff present.

# 2. Migration boot guard
NODE_ENV=production MIGRATIONS_ON_START=true pnpm run start
# Expected: process exits with the explicit error.

NODE_ENV=production MIGRATIONS_ON_START=true ALLOW_MIGRATIONS_IN_PROD=1 pnpm run start
# Expected: starts, with a loud warning.

NODE_ENV=production MIGRATIONS_ON_START=false pnpm run start
# Expected: starts, no migrations run.

# 3. Advisory lock — start two app instances with the same DB
NODE_ENV=development MIGRATIONS_ON_START=true pnpm run start &
NODE_ENV=development MIGRATIONS_ON_START=true pnpm run start &
wait
# Expected: only one runs migrations; the other waits and observes "no pending".
```

## References

- [Helmet.js](https://helmetjs.github.io/) — list of headers it sets and tradeoffs
- [OWASP Secure Headers Project](https://owasp.org/www-project-secure-headers/)
- [PostgreSQL: Advisory locks](https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS)
- [Kubernetes: Init Containers for migrations](https://kubernetes.io/docs/concepts/workloads/pods/init-containers/)
- [12-Factor App: Build, release, run](https://12factor.net/build-release-run) — schema migrations belong to release, not boot
