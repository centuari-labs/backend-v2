# F-31: WebSocket recent-trades cache is poisonable and persists indefinitely on quiet markets

**Severity**: 🟡 Moderate (compounds with F-15 and F-18)
**OWASP**: A04 Insecure Design, A08 Software & Data Integrity
**CWE**: CWE-345 (Insufficient Verification of Data Authenticity), CWE-840 (Business Logic Errors)

## Summary

The `EventsGateway` keeps a per-asset in-memory cache of the last 20 trades (`recentTradesCache`). It accepts every NATS `matches.created` event without source verification, prepends it to the cache, and emits the cache as a snapshot to every new subscriber. There is no time-based eviction — entries are only displaced when 20 newer trades arrive.

On a low-volume market, a single forged `matches.created` event (per **F-18**, NATS has no auth) can sit in the cache for hours or days, displayed to every front-end client that subscribes. Because the WebSocket itself has no authentication (**F-15**), the audience for this poisoned snapshot is unbounded.

## Evidence

`src/core/websocket/websocket.gateway.ts:614-647` (cache mutation):

```typescript
public handleMatchCreated(trade: RecentTradeDto) {
    const room = `recent-trades:${trade.assetId}`;
    const cached = this.recentTradesCache.get(room) ?? [];
    cached.unshift(trade);                                 // ⚠️ unconditional prepend
    if (cached.length > this.maxRecentTrades) {
        cached.length = this.maxRecentTrades;
    }
    this.recentTradesCache.set(room, cached);
    // ⚠️ no per-entry TTL, no source verification, no shape validation

    const socketsInRoom = this.server.sockets.adapter.rooms.get(room);
    this.logger.log(
        `recent-trade → room=${room}, clients=${socketsInRoom?.size ?? 0}, trade=${JSON.stringify(trade)}`,
    );

    this.server.to(room).emit("recent-trade", trade);
}
```

Subscribe path (`src/core/websocket/websocket.gateway.ts:649-664`):

```typescript
@SubscribeMessage("subscribe-recent-trades")
handleSubscribeRecentTrades(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: SubscribeRecentTradesDto,
) {
    const room = `recent-trades:${body.assetId}`;
    client.join(room);
    const cached = this.recentTradesCache.get(room);
    if (cached && cached.length > 0) {
        client.emit("recent-trades-snapshot", cached);     // ⚠️ poisoned snapshot served
    }
    return { success: true, room };
}
```

NATS feed source (`setupNatsSubscriptions`):

```typescript
await this.natsService.subscribe("matches.>", (data, subject) => {
    if (subject === "matches.created") {
        this.handleMatchCreated(data as RecentTradeDto);
    }
});
```

The `data as RecentTradeDto` cast is a lie — the gateway never validates the message shape, so a forged payload with arbitrary fields and types is accepted.

## Impact

- **F-31.1 — Long-lived poisoned trade history**: on a market with sparse real activity, one forged `matches.created` event with a fabricated price/rate displays in every new subscriber's recent-trades list. Eviction requires 20 *real* trades on the same asset; on a quiet market that's hours-to-days.
- **F-31.2 — Misleading market signal**: traders using the WS feed to time entries see a fake recent rate. If they place market orders against the (also unauthenticated and forge-able, see F-15 + F-29) orderbook based on this signal, real money moves against them.
- **F-31.3 — Cross-asset poisoning**: `room = recent-trades:${trade.assetId}` is keyed by attacker-controlled `assetId`. An attacker can plant snapshots for arbitrary assetIds — including ones that don't yet exist in the system. New subscribers to those rooms get garbage that survives forever (no real trades will ever displace it because the assetId is invalid).
- **F-31.4 — Memory growth**: each forged `assetId` allocates a new cache entry. `recentTradesCache` is an unbounded `Map` keyed on attacker input → memory exhaustion over time. With **F-2** absent, this scales with attacker request rate.
- **F-31.5 — Combined with F-15**: any web origin can connect, subscribe to recent-trades, and pull the poisoned snapshot. Even without forging, the snapshot itself contains data (other users' fills) that may be sensitive depending on what `RecentTradeDto` includes.

## Reproduction

```bash
# 1. Forge a matches.created event via NATS (F-18 — no auth)
nats pub --server nats://localhost:4222 matches.created \
    '{"assetId":"poisoned-asset-id","rate":99.99,"amount":"1000000","timestamp":1714000000000}'

# 2. From any browser console (F-15 — no auth)
const sock = io("http://localhost:8080");
sock.emit("subscribe-recent-trades", { assetId: "poisoned-asset-id" });
sock.on("recent-trades-snapshot", console.log);
// Output: the forged trade.

# 3. Memory growth
for i in $(seq 1 100000); do
    nats pub --server nats://localhost:4222 matches.created \
        "{\"assetId\":\"poison-$i\",\"rate\":1,\"amount\":\"1\",\"timestamp\":1}"
done
# `recentTradesCache.size` is now 100000, with no eviction path.
```

## Recommended Solution

The root causes (F-15 missing WS auth, F-18 missing NATS auth/validation) are the priority — fixing them removes the attack vector entirely. Specific hardening for this cache:

### 1. Validate every NATS message before mutating the cache

Use the schema-validation pattern from F-18:

```typescript
import { z } from "zod";

const RecentTradeMessage = z.object({
    assetId: z.string().uuid(),
    rate: z.number().int().min(0).max(10_000),
    amount: z.string().regex(/^\d+$/).max(40),
    timestamp: z.number().int().positive(),
    // any other fields used by toRecentTradeDto
});

public handleMatchCreated(raw: unknown) {
    const parsed = RecentTradeMessage.safeParse(raw);
    if (!parsed.success) {
        this.logger.warn(`Dropping malformed matches.created: ${parsed.error.message}`);
        return;
    }
    const trade = parsed.data;
    // ... continue with the original logic
}
```

This blocks shape-level forgery (random fields, wrong types) and the `recent-trades:invalid-uuid` room-allocation vector.

### 2. Verify the trade exists in the database before caching

The matching engine should be the only legitimate source of `matches.created`. Cross-check against the `matches` table:

```typescript
public async handleMatchCreated(raw: unknown) {
    const parsed = RecentTradeMessage.safeParse(raw);
    if (!parsed.success) return;
    const trade = parsed.data;

    // Don't trust NATS — confirm the row exists in DB.
    const exists = await this.matchesRepository.findOne({
        where: { id: (trade as any).matchId },
    });
    if (!exists) {
        this.logger.warn(`Dropping unverified matches.created for assetId=${trade.assetId}`);
        return;
    }

    // ... cache mutation
}
```

A short DB read per match event closes F-31 against any forge that doesn't also write to the DB. Cache the existence check for ~5 s if volume is high.

### 3. Per-entry TTL on the cache

Even legitimate trades should age out after some time so a stale market doesn't show day-old "recent" trades:

```typescript
private static readonly RECENT_TRADE_TTL_MS = 30 * 60 * 1000;  // 30 min

public handleMatchCreated(trade: RecentTradeDto) {
    const room = `recent-trades:${trade.assetId}`;
    const now = Date.now();
    const cached = (this.recentTradesCache.get(room) ?? []).filter(
        (t) => now - t.timestamp < EventsGateway.RECENT_TRADE_TTL_MS,
    );
    cached.unshift(trade);
    if (cached.length > this.maxRecentTrades) cached.length = this.maxRecentTrades;
    this.recentTradesCache.set(room, cached);
}
```

Apply the same filter on `subscribe-recent-trades` before emitting the snapshot.

### 4. Bound the cache by asset

Prevent `recentTradesCache` from holding entries for unknown assets:

```typescript
public handleMatchCreated(trade: RecentTradeDto) {
    if (!this.knownAssetIds.has(trade.assetId)) {
        this.logger.warn(`Dropping recent-trade for unknown asset ${trade.assetId}`);
        return;
    }
    // ...
}
```

Where `knownAssetIds` is populated from the DB on startup and refreshed on `Token` changes.

### 5. Bound cache size globally

If the asset whitelist isn't practical, cap the cache:

```typescript
private static readonly MAX_ROOMS = 200;

if (!this.recentTradesCache.has(room) && this.recentTradesCache.size >= EventsGateway.MAX_ROOMS) {
    // evict oldest room
    const oldest = [...this.recentTradesCache.keys()][0];
    this.recentTradesCache.delete(oldest);
}
```

### 6. Don't include sensitive fields in the snapshot

Audit `RecentTradeDto` shape: it should expose only public market data (rate, amount, timestamp). If it currently includes `walletAddress`, `accountId`, or anything user-specific, strip those before broadcasting.

```typescript
private toPublicTrade(trade: RecentTradeDto) {
    return {
        rate: trade.rate,
        amount: trade.amount,
        timestamp: trade.timestamp,
        assetId: trade.assetId,
    };
}
```

Same pattern as the F-15 fix for `toOrderPayload`.

## Verification

```javascript
// 1. Forge attempt — should be silently dropped (logged at warn)
await natsClient.publish("matches.created", JSON.stringify({ assetId: "not-a-uuid" }));
expect(loggerWarn).toHaveBeenCalledWith(/malformed/);

// 2. DB cross-check — forge with a valid assetId but no matching row
await natsClient.publish("matches.created", JSON.stringify({
    assetId: "<known asset>",
    matchId: "00000000-0000-0000-0000-000000000000",
    rate: 500, amount: "1000", timestamp: Date.now(),
}));
const sock = io("http://localhost:8080", { auth: { token: "DEV_TOKEN_0x..." } });
sock.emit("subscribe-recent-trades", { assetId: "<known asset>" });
const snapshot = await new Promise((res) => sock.once("recent-trades-snapshot", res));
expect(snapshot.find((t) => t.matchId === "00000000-...")).toBeUndefined();

// 3. TTL — emit a real trade, wait 31 min, subscribe new client
//    Snapshot should be empty.
```

## References

- [Socket.IO room scoping](https://socket.io/docs/v4/rooms/)
- [OWASP A04:2021 — Insecure Design](https://owasp.org/Top10/A04_2021-Insecure_Design/)
- [CWE-345: Insufficient Verification of Data Authenticity](https://cwe.mitre.org/data/definitions/345.html)
