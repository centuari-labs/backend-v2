# F-38: WS `subscribe-orderbook` triggers expensive DB read per request — DoS amplifier

**Severity**: 🟠 High (combined with F-15 / F-2)
**OWASP**: A04 Insecure Design, A05 Security Misconfiguration
**CWE**: CWE-770 (Allocation of Resources Without Limits or Throttling), CWE-405 (Asymmetric Resource Consumption)

## Summary

The WebSocket gateway's `subscribe-orderbook` handler invokes `loadOrdersFromDb(assetId)` and `aggregateAndBroadcastOrderbook(assetId)` on every message, regardless of whether the asset has been loaded before. With **F-15** (no WS auth) and **F-2** (no global rate limit), an unauthenticated client can fire thousands of `subscribe-orderbook` events per second, each pulling all open + partially-filled limit orders for the asset out of Postgres and rebuilding the in-memory orderbook in Node.

The work the server does per attacker-byte is **massively asymmetric** — a 30-byte WS frame triggers a multi-row DB scan, full TypeORM hydration, BigInt arithmetic across all orders, and a websocket broadcast to every other client in the room.

## Evidence

`src/core/websocket/websocket.gateway.ts:578-595`:

```typescript
@SubscribeMessage("subscribe-orderbook")
async handleSubscribeOrderbook(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: SubscribeOrderbookDto,
) {
    const room = `orderbook:${body.assetId}`;
    client.join(room);
    this.logger.log(`Client ${client.id} joined ${room}`);

    await this.loadOrdersFromDb(body.assetId);             // ⚠️ unconditional DB read
    await this.aggregateAndBroadcastOrderbook(body.assetId); // ⚠️ unconditional aggregate + broadcast
    const cached = this.orderbookCache.get(room);
    if (cached) {
        client.emit("orderbook-update", cached);
    }

    return { success: true, room };
}
```

`loadOrdersFromDb` (lines further down) issues:

```typescript
const rows = await this.orderRepository.findActiveLimitOrdersForOrderbook(assetId);
for (const row of rows) {
    const remaining = BigInt(row.quantity) - BigInt(row.filledQuantity || "0");
    this.orderState.set(row.id, { ... });   // mutates shared in-memory state
}
```

`findActiveLimitOrdersForOrderbook(assetId)` (`src/orders/repositories/order.repository.ts:272`) is a multi-column `SELECT ... FROM orders` with a join on `order_markets`, no `LIMIT`, ordered by side/rate. On a populated orderbook this is a non-trivial query.

`aggregateAndBroadcastOrderbook` then:

1. Filters every entry of `this.orderState` (which after enough activity contains many assets).
2. Calls `fetchActiveOrderIds(assetId)` — another DB read (5-second cached, but the cache is per-asset and `subscribe-orderbook` for a *new* asset bypasses it).
3. Aggregates levels in JavaScript with BigInt arithmetic.
4. Broadcasts `orderbook-update` to every client in the room (including all the other attacker connections).

There is no rate limit, no per-IP cap, no asset-existence check, no cache check before triggering the load.

### Attacker-controlled `assetId` shape

`SubscribeOrderbookDto`:

```typescript
export interface SubscribeOrderbookDto {
    assetId: string;                       // ⚠️ no validation
}
```

No `@IsUUID()`, no length cap. An attacker can spam `subscribe-orderbook` with random or crafted strings:

- A random UUID → DB query returns 0 rows but query still runs.
- A bogus value like `"x".repeat(10000)` → DB query may be slower (parameterized, so no SQLi, but the parameter is still bound and compared against UUID column → cast error or 0 rows).
- The same assetId thousands of times → cache hits but `loadOrdersFromDb` still runs unconditionally.

### Compounding allocations

Each call also writes into `this.orderState` (a `Map`) with whatever orders the DB returns. Phantom assetIds populate `this.recentTradesCache` (per F-31), `this.orderbookCache`, and `this.orderState`. None of these have a global cap.

## Impact

- **F-38.1 — DB pool exhaustion**: a few hundred concurrent attacker connections firing `subscribe-orderbook` rapidly saturate the Postgres pool. Legitimate REST endpoints (`/portfolio/*`, `/orders/*`) get pool-acquire timeouts. Combined with **F-21** (no statement_timeout) and **F-2** (no rate limit), this is a single-machine denial-of-service vector.
- **F-38.2 — CPU pin**: BigInt arithmetic in `aggregateLevels` over a hot orderbook with 1000+ orders is expensive. Triggered N times per second per attacker byte, the Node event loop stalls.
- **F-38.3 — `orderState` memory growth**: each new assetId allocates a Map entry that's never pruned. Map grows unbounded with attacker input — combined with **F-31** (same problem on `recentTradesCache`), the gateway's RSS climbs until the host kills the process.
- **F-38.4 — Outbound WS amplification**: every `subscribe-orderbook` re-broadcasts `orderbook-update` to every client already in the room. An attacker who has 100 sockets open in the same room (allowed because **F-15** has no per-IP cap) can amplify each subscribe into a 100-socket emit.
- **F-38.5 — Combined with F-15 (no WS auth)**: any web origin can do this without a token.
- **F-38.6 — Combined with F-31 (recent trades cache)**: a complete unauth WS DoS toolkit targets `recentTradesCache` (memory) + `subscribe-orderbook` (DB+CPU).

## Reproduction

```javascript
// From any origin (F-15: no WS auth):
const sockets = [];
for (let i = 0; i < 100; i++) {
    const s = io("http://localhost:8080", { transports: ["websocket"] });
    s.on("connect", () => {
        setInterval(() => {
            s.emit("subscribe-orderbook", {
                assetId: crypto.randomUUID(),  // new asset each time, defeats any cache
            });
        }, 50);  // 20 events/sec/socket
    });
    sockets.push(s);
}
// 100 sockets × 20 events/sec = 2000 DB reads/sec

// On the server, watch:
// - active connections in Postgres pool
// - process RSS climbing
// - REST endpoint p99 latency degrading
```

## Recommended Solution

The root fix is two existing findings (F-15 + F-2). Per-handler hardening below stops the bleeding even before those land:

### 1. Throttle the handler at the gateway

```typescript
private subscribeRate = new Map<string, { count: number; resetAt: number }>();

@SubscribeMessage("subscribe-orderbook")
async handleSubscribeOrderbook(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: SubscribeOrderbookDto,
) {
    if (!this.allowSubscribe(client)) {
        return { success: false, error: "Rate limited" };
    }
    // ... rest
}

private allowSubscribe(client: Socket): boolean {
    const ip = client.handshake.address;
    const now = Date.now();
    const bucket = this.subscribeRate.get(ip);
    if (bucket && bucket.resetAt > now) {
        if (bucket.count >= 30) return false;        // 30 subscribes/min/IP
        bucket.count++;
        return true;
    }
    this.subscribeRate.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
}
```

For multi-instance deployments, back this with Redis (same store as the F-2 throttler).

### 2. Validate `assetId` (UUID) before any DB read

```typescript
import { z } from "zod";

const SubscribeOrderbookSchema = z.object({
    assetId: z.string().uuid(),
});

@SubscribeMessage("subscribe-orderbook")
async handleSubscribeOrderbook(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
) {
    const parsed = SubscribeOrderbookSchema.safeParse(body);
    if (!parsed.success) return { success: false, error: "Invalid assetId" };
    const { assetId } = parsed.data;

    // Existence check against the in-memory token whitelist (cached at boot, F-40)
    if (!this.tokensService.knownAssetIds.has(assetId)) {
        return { success: false, error: "Unknown asset" };
    }
    ...
}
```

UUID + whitelist closes the "use unique random assetId per request" attack — random UUIDs are rejected at validation, real ones return cached state without a DB hit.

### 3. Skip `loadOrdersFromDb` when in-memory state is already fresh

Add a per-asset freshness timestamp:

```typescript
private orderStateLoadedAt = new Map<string, number>();
private static readonly LOAD_TTL_MS = 5_000;

private async loadOrdersFromDb(assetId: string): Promise<void> {
    const lastLoaded = this.orderStateLoadedAt.get(assetId) ?? 0;
    if (Date.now() - lastLoaded < EventsGateway.LOAD_TTL_MS) {
        return;   // skip the DB read
    }
    try {
        const rows = await this.orderRepository.findActiveLimitOrdersForOrderbook(assetId);
        // ... existing population
        this.orderStateLoadedAt.set(assetId, Date.now());
    } catch (err) {
        ...
    }
}
```

A second subscribe within 5 s for the same asset hits the cache. Combined with the room-level cache that already exists (`orderbookCache`), most subscribes return without a DB read.

### 4. Don't re-broadcast on subscribe — emit only to the new client

```typescript
@SubscribeMessage("subscribe-orderbook")
async handleSubscribeOrderbook(...) {
    // ... validation, throttle, room join

    await this.loadOrdersFromDb(body.assetId);
    const cached = this.orderbookCache.get(room);
    if (cached) {
        client.emit("orderbook-update", cached);  // only the new subscriber
    } else {
        // First-ever subscribe for this asset: aggregate once, then emit only to this client
        await this.aggregateOrderbookForRoom(body.assetId, /* broadcast */ false);
        const fresh = this.orderbookCache.get(room);
        if (fresh) client.emit("orderbook-update", fresh);
    }
    return { success: true, room };
}
```

Only the matching engine's NATS events should trigger room-wide broadcasts.

### 5. Cap `orderbookCache`, `orderState`, `recentTradesCache` sizes globally

```typescript
private static readonly MAX_TRACKED_ASSETS = 200;

private addToOrderState(orderId: string, tracked: TrackedOrder) {
    if (this.orderState.size >= EventsGateway.MAX_TRACKED_ASSETS * 1000) {
        // evict oldest entries (LRU or simple FIFO via a separate Map ordering)
        const firstKey = this.orderState.keys().next().value;
        if (firstKey) this.orderState.delete(firstKey);
    }
    this.orderState.set(orderId, tracked);
}
```

A bounded cache turns the memory-growth attack into a CPU-only attack, which is at least monitored.

### 6. Per-room subscriber cap

```typescript
const room = `orderbook:${body.assetId}`;
const sockets = await this.server.in(room).fetchSockets();
if (sockets.length >= 1000) {
    return { success: false, error: "Room is full" };
}
client.join(room);
```

Stops the broadcast-amplification factor.

### 7. DB statement_timeout (already covered in F-21, restated)

```typescript
this.pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    statement_timeout: 5_000,
    query_timeout: 5_000,
});
```

Even if all the above somehow leaks, no query holds a pool connection for more than 5 s.

## Verification

```bash
# 1. Throttler kicks in
node -e "
const { io } = require('socket.io-client');
const s = io('http://localhost:8080', { transports: ['websocket'] });
s.on('connect', async () => {
    for (let i = 0; i < 100; i++) {
        s.emit('subscribe-orderbook', { assetId: 'aaaa1111-1111-1111-1111-111111111111' });
    }
});
"
# Expected (post-fix): server logs show 30 accepted then 'Rate limited' for the rest.

# 2. Random UUID rejected
s.emit('subscribe-orderbook', { assetId: 'random-not-uuid-string' });
# Expected: { success: false, error: 'Invalid assetId' }, no DB read.

# 3. Cache hit
# Pull `pg_stat_statements` snapshot, fire two subscribes for the same asset, ensure
# the orderbook query count increases by at most 1 across the two.
```

## References

- [Socket.IO scaling and rate limiting](https://socket.io/docs/v4/troubleshooting-connection-issues/)
- [OWASP: Asymmetric resource consumption](https://owasp.org/API-Security/editions/2023/en/0xa6-unrestricted-access-to-sensitive-business-flows/)
- [CWE-405: Asymmetric Resource Consumption](https://cwe.mitre.org/data/definitions/405.html)
