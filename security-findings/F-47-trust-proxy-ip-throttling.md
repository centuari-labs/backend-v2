# F-47: Express not configured with `trust proxy` — IP-based rate limiting collapses behind any reverse proxy

**Severity**: 🟡 Moderate (turns into High once F-2 lands)
**OWASP**: A05 Security Misconfiguration, A04 Insecure Design
**CWE**: CWE-348 (Use of Less Trusted Source), CWE-940 (Improper Verification of Source of a Communication Channel)

## Summary

`main.ts` builds a Nest application around the default Express adapter without ever calling `app.set('trust proxy', ...)`. Express therefore returns the **last hop's IP** (the load balancer / reverse proxy / sidecar) from `req.ip`, not the originating client's IP. Once **F-2** wires a global `ThrottlerGuard` and adds an `IpThrottlerGuard` for pre-auth routes (per the F-2 / F-15 / F-7 remediations), every IP-based bucket sees one IP — the proxy — and treats every real client as the same identity. The throttler effectively does nothing.

Today the consequence is small because no IP-based throttler is wired (F-2 is open). The moment F-2 is implemented per its recommended patch, the throttler ships with the silently-broken IP read.

## Evidence

`src/main.ts:24-46`:

```typescript
async function bootstrap() {
    if (process.env.MIGRATIONS_ON_START === "true") {
        await runMigrations();
    }
    if (process.env.SEED_ON_START === "true") {
        await runSeeds();
    }

    const app = await NestFactory.create(AppModule);

    app.enableShutdownHooks();
    app.enableCors({...});
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(new ValidationPipe({...}));

    app.use(json({ limit: "10kb" }));
    app.use(urlencoded({ limit: "10kb", extended: true }));

    await app.listen(process.env.PORT ?? 3000);
}
```

There is no:

```typescript
app.set("trust proxy", "loopback, linklocal, uniquelocal");
// or
app.set("trust proxy", 1);
// or per-deployment specific trust list
```

Express defaults to `trust proxy: false`. With that default:

- `req.ip` returns the immediate TCP peer (the proxy).
- `req.ips` returns `[]`.
- `X-Forwarded-For` is parsed but ignored for the `req.ip` value.

`WalletThrottlerGuard` already references this:

`src/common/guards/wallet-throttler.guard.ts:7`:
```typescript
protected async getTracker(req: Record<string, any>): Promise<string> {
    return req.user?.walletAddress ?? req.ip;
}
```

The `?? req.ip` branch is hit on routes that don't have `AuthGuard` populated `req.user`. With no `trust proxy`, that fallback is the proxy IP — every client buckets into the same key.

A grep confirms the codebase never reads forwarded headers explicitly either:

```bash
$ grep -rnE "request\.ip|req\.ip|x-forwarded-for|forwardedHeaders|trust.proxy" src --include="*.ts"
src/common/guards/wallet-throttler.guard.ts:7:        return req.user?.walletAddress ?? req.ip;
```

So `req.ip` is the only way IP-derived state enters anywhere, and it's wrong behind a proxy.

## Impact

### A. After the F-2 fix, IP-based rate limit buckets collapse

The recommended F-2 patch wires `ThrottlerGuard` globally and adds an `IpThrottlerGuard` for pre-auth endpoints (login, validate, faucet, redeem-access-code). All of these will use `req.ip` as the tracker.

Behind a proxy:

- Every legitimate user's request looks like it came from the LB IP.
- The bucket's quota (e.g. `5 req/s, 60 req/min`) is shared across all users.
- A handful of real users normally trigger 429s for everyone else.
- An attacker who saturates the bucket from a single IP causes a service-wide DoS — every user is locked out for the bucket window because they share the bucket.

Concretely: F-7 fix adds `@Throttle({ default: { limit: 3, ttl: 60_000 } })` on `/faucet/request-tokens`. Behind a proxy, the bucket gates **all** real clients combined — 3 faucet requests per minute total, regardless of how many users are trying to claim.

### B. F-15 fix's "max clients per IP" gates collapse identically

F-15's recommended `clientsByIp` cap (10 sockets per IP) becomes "10 sockets total for all real users behind the proxy."

### C. The current `WalletThrottlerGuard` on `OrdersController` is mostly OK because `walletAddress` is the primary tracker — but its fallback to `req.ip` is silently broken.

### D. Audit logging based on IP is also wrong

The F-22 / F-37 recommendations include logging the originating IP for failed auth attempts. With no `trust proxy`, the log entry is the LB's IP every time. Forensic value: zero.

### E. Combined with `X-Forwarded-For` spoofing if `trust proxy` is later set wrong

This is the dual failure mode. A naïve fix of `app.set("trust proxy", true)` trusts every hop including the client itself. An attacker sends `X-Forwarded-For: 1.1.1.1` and Express returns `1.1.1.1` as `req.ip`. The throttler now buckets per-attacker-controlled value — every request gets a fresh bucket, throttling is bypassed entirely.

So the fix is *specific*: trust only the IPs of the actual proxy hops, no further.

## Recommended Solution

### 1. Determine the real proxy topology, then configure exactly

There's no one-size-fits-all answer. Pick whichever matches the deploy:

```typescript
// src/main.ts
const httpAdapter = app.getHttpAdapter();
const expressApp = httpAdapter.getInstance();

if (process.env.TRUSTED_PROXY) {
    // Comma-separated list of trusted proxy IPs/CIDRs (e.g. "10.0.0.0/8" for ECS, the LB's IP, etc.)
    expressApp.set("trust proxy", process.env.TRUSTED_PROXY.split(","));
} else if (process.env.NODE_ENV === "production") {
    throw new Error(
        "TRUSTED_PROXY env var must be set in production " +
        "(e.g. 'loopback' for localhost-only, the LB's CIDR for cloud deploys, " +
        "or 'false' for direct exposure).",
    );
} else {
    // Dev: trust loopback so localhost-bound clients work normally.
    expressApp.set("trust proxy", "loopback");
}
```

Common values:

| Topology | `TRUSTED_PROXY` |
|----------|------------------|
| ECS / Fargate behind ALB | `10.0.0.0/8` (the VPC CIDR; ALB is in there) |
| GKE / EKS behind a Service LB | `loopback, linklocal, uniquelocal` |
| Direct exposure (no proxy) | `false` (literal — disables forwarded-header trust) |
| Cloudflare in front of LB | the LB's CIDR; do NOT trust Cloudflare's CIDR alone (because that lets attackers spoof X-Forwarded-For via direct LB connections) |
| Local dev | `loopback` |

The boot-time enforcement makes the deployment explicit. A misconfigured prod can't silently fall back to "trust nothing" — it refuses to start.

### 2. Use `ips[0]` instead of `ip` where the right answer is "the most-trusted forwarded value"

`req.ip` returns the *first untrusted* hop counting from the client side. For some throttling cases (e.g. trust the immediate proxy but record the actual client) you want `req.ips[0]`:

```typescript
// src/common/guards/wallet-throttler.guard.ts
protected async getTracker(req: Record<string, any>): Promise<string> {
    if (req.user?.walletAddress) return req.user.walletAddress.toLowerCase();
    // Behind a trusted proxy with X-Forwarded-For: a, b, c
    // and trust proxy correctly set, req.ips = [a, b, c] and req.ip = "a".
    return req.ip ?? req.ips?.[0] ?? "unknown";
}
```

(The `?.toLowerCase()` is a separate fix tied to F-36.)

### 3. Lock the request shape — refuse spoofed direct-client headers if `trust proxy` is false

```typescript
@Injectable()
export class StripUntrustedHeadersMiddleware implements NestMiddleware {
    use(req: Request, _res: Response, next: NextFunction) {
        if (process.env.NODE_ENV === "production" && !this.behindProxy()) {
            // No proxy → strip headers an attacker might spoof.
            delete req.headers["x-forwarded-for"];
            delete req.headers["x-forwarded-host"];
            delete req.headers["x-forwarded-proto"];
            delete req.headers["x-real-ip"];
        }
        next();
    }
    private behindProxy(): boolean {
        return Boolean(process.env.TRUSTED_PROXY);
    }
}
```

Wire it global. Now even libraries that read forwarded headers directly (rather than going through Express) see the cleaned values.

### 4. Health endpoint exposes resolved IP

```typescript
@Get("debug/whoami")
whoami(@Req() req: Request) {
    return { ip: req.ip, ips: req.ips, headers: req.headers };
}
```

(Gate behind admin secret.) Operators verify the topology by curling the endpoint from a known client IP.

### 5. CI / runtime validation

```typescript
// src/main.ts (after trust-proxy setup)
if (process.env.NODE_ENV === "production") {
    expressApp.use((req: Request, _res: Response, next: NextFunction) => {
        if (!req.ip) {
            this.logger.error("req.ip resolved as empty; trust proxy probably misconfigured");
        }
        next();
    });
}
```

A few minutes of prod traffic exposes any misconfiguration.

## Verification

```bash
# 1. Local dev — req.ip is loopback
curl http://localhost:8080/health
# (after adding the debug endpoint)
# Expected: { ip: "127.0.0.1" or "::1", ips: [] }

# 2. Production-like with X-Forwarded-For from an untrusted client
curl http://localhost:8080/health -H "X-Forwarded-For: 1.2.3.4"
# Expected (no trust proxy / "false"): ip="127.0.0.1", X-Forwarded-For ignored.

# 3. Production-like with X-Forwarded-For from a trusted proxy
TRUSTED_PROXY=127.0.0.1 pnpm run start
curl http://localhost:8080/health -H "X-Forwarded-For: 1.2.3.4"
# Expected: ip="1.2.3.4" (forwarded header honored because peer is trusted).

# 4. Boot-time refusal in prod when TRUSTED_PROXY is unset
NODE_ENV=production pnpm run start
# Expected: process exits with the explicit error.

# 5. Throttler bucket is per-real-client, not per-LB
# Behind a real LB: hammer /auth/login from 5 different clients.
# Expected: each client gets their own bucket, none reach the bucket cap simultaneously.
```

## References

- [Express: trust proxy](https://expressjs.com/en/guide/behind-proxies.html)
- [express-rate-limit: deployments behind a proxy](https://express-rate-limit.mintlify.app/guides/troubleshooting-proxy-issues)
- [NestJS Throttler with trust proxy](https://docs.nestjs.com/security/rate-limiting#proxies)
- [CWE-348: Use of Less Trusted Source](https://cwe.mitre.org/data/definitions/348.html)
- [Cloudflare: How to safely trust proxy headers](https://developers.cloudflare.com/fundamentals/get-started/concepts/cloudflare-ip-addresses/)
- See also F-2 (no global throttler), F-7 (faucet auth + per-wallet quota), F-15 (WS no auth + per-IP cap recommendation)
