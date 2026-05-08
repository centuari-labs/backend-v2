# F-18: NATS trust boundary — gateway accepts arbitrary publishers

**Severity**: 🟠 High (deployment-dependent)
**OWASP**: A04 Insecure Design, A05 Security Misconfiguration
**CWE**: CWE-306 (Missing Authentication for Critical Function), CWE-940 (Improper Verification of Source of a Communication Channel)

## Summary

The `EventsGateway` subscribes to NATS subjects `orders.>` and `matches.>` and treats every message as authoritative — re-emitting it to user-scoped websocket rooms with no integrity check. The NATS server itself runs without authentication and was started bound to `0.0.0.0:4222` in development.

Anyone with network access to the NATS port can:
- Publish forged `orders.lend.*` / `orders.borrow.*` events with arbitrary `walletAddress` / `accountId`, which the gateway puts into in-memory state and broadcasts to the spoofed user's room (combined with F-15, no auth on WS, this becomes trivial real-time injection of fake fills).
- Publish `orders.cancel` events that flip `tracked.status = OrderStatus.Cancelled` on real orders in the gateway's in-memory cache.
- Publish `orders.status` events that mutate `remainingAmount` in the gateway's view of an order.
- Publish `matches.created` events that appear in `recent-trades-snapshot` cache and broadcast to all subscribers.

These are in-memory only — DB state isn't directly mutated — but every WS client downstream sees the forged data.

## Evidence

`docker run -d --name nats -p 4222:4222 -p 8222:8222 nats:2.10 -js`
- Port `4222` is published on `0.0.0.0`. Anyone on the host's network can connect.
- No `--user`, no `--auth`, no `--config` for credentials.

`src/core/nats/nats.service.ts`:
```typescript
const options: ConnectionOptions = {
    servers: this.natsUrl,
    maxReconnectAttempts: -1,
    reconnectTimeWait: 1000,
    name: "centuari-backend",
};
this.connection = await connect(options);
// ⚠️ no user/pass, no token, no nkey/JWT
```

`src/core/websocket/websocket.gateway.ts`:
```typescript
await this.natsService.subscribe("orders.>", (data, subject) => {
    this.handleOrdersMessage(data, subject);
});

private handleOrderCreation(msg: OrderCreationMessage, subject: string) {
    const tracked: TrackedOrder = {
        orderId: msg.orderId,
        accountId: msg.walletAddress,         // ⚠️ accepted as-is from NATS payload
        walletAddress: msg.walletAddress,     // ⚠️ ditto
        // ...
    };
    this.orderState.set(msg.orderId, tracked);
    this.emitUserPosition(tracked, subject);  // emits to user:<accountId> room
}
```

There is no schema validation, no signature, no source check, no replay window.

## Impact

- **F-18.1 — Forged user-position injection**: an attacker on the LAN/CI network publishes
  ```json
  // subject: orders.lend.created
  { "orderId": "fake-1", "walletAddress": "<victim accountId>", "originalAmount": "999...", ... }
  ```
  The gateway broadcasts this to the victim's WS room. Victim's UI shows a fake fill / open position.
- **F-18.2 — Cancel/status spoofing**: by publishing `orders.cancel` or `orders.status`, the attacker mutates `orderState` for real orders in the gateway. WS clients see incorrect state. DB isn't touched, so eventual reconciliation happens, but during the window the system shows wrong data.
- **F-18.3 — Recent trades poisoning**: `matches.created` payload is unconditionally cached and broadcast. Attacker can inject fake trade prints into the public recent-trades feed for any market.
- **F-18.4 — In-memory cache poisoning persists**: the `orderState` map only evicts on terminal status. An injected "open" order with a forged `assetId` stays in memory and pollutes orderbook aggregation until restart or the manual cleanup interval expires it.

The exploitability depends entirely on whether the NATS port is exposed beyond the trust boundary the team intends:
- **Localhost only on a single VM** → low actual risk.
- **Docker network with other untrusted services / staging environment / reachable from CI** → high.
- **Published via cloud LB or accessible via VPN-shared internal network** → critical.

## Recommended Solution

### 1. Authenticate NATS clients

Run NATS with credentials. Either basic user/pass or NATS nkeys (preferred — asymmetric keys, no shared secret):

```yaml
# nats-server.conf
authorization {
    users = [
        { user: backend, password: "$2a$11$..."  }   # bcrypt
        { user: matcher, password: "$2a$11$..." }
    ]
}
```

Or with NKEYS / decentralized auth (`nsc`):

```bash
nsc add account Centuari
nsc add user --account Centuari backend --allow-pub "orders.>,matches.>" --allow-sub "orders.>,matches.>"
```

Update `NATS_URL`:
```
NATS_URL=nats://backend:<password>@nats-host:4222
# or
NATS_CREDS_FILE=/secrets/backend.creds
```

`src/core/nats/nats.service.ts`:
```typescript
const options: ConnectionOptions = {
    servers: this.natsUrl,
    name: "centuari-backend",
    user: process.env.NATS_USER,
    pass: process.env.NATS_PASSWORD,
    // or: authenticator: credsAuthenticator(readFileSync(process.env.NATS_CREDS_FILE!)),
};
```

### 2. Bind NATS to localhost / private network only

```diff
- docker run -d --name nats -p 4222:4222 -p 8222:8222 nats:2.10 -js
+ docker run -d --name nats -p 127.0.0.1:4222:4222 -p 127.0.0.1:8222:8222 nats:2.10 \
+   -js -c /etc/nats/nats-server.conf
```

In production: use a private VPC / Docker network only; don't publish 4222.

### 3. Subject-level authorization (defense in depth)

Even with auth, restrict each service to the subjects it needs:

```yaml
authorization {
    users = [
        {
            user: backend,
            password: "...",
            permissions: {
                publish: ["orders.>"]
                subscribe: ["matches.>"]
            }
        }
        {
            user: matcher,
            password: "...",
            permissions: {
                publish: ["matches.>", "orders.status", "orders.cancel"]
                subscribe: ["orders.lend.>", "orders.borrow.>", "orders.update"]
            }
        }
    ]
}
```

This prevents a compromised `backend` service from publishing match events.

### 4. Schema-validate inbound messages

Treat NATS messages like any other untrusted input:

```typescript
import { z } from "zod";

const OrderCreationMessage = z.object({
    orderId: z.string().uuid(),
    walletAddress: z.string().regex(/^0x[a-f0-9]{40}$/i),
    loanToken: z.string().regex(/^0x[a-f0-9]{40}$/i),
    assetId: z.string().uuid().optional(),
    markets: z.array(z.object({
        marketId: z.string().uuid(),
        maturity: z.number().int().nonnegative(),
    })).max(50),
    side: z.enum(["LEND", "BORROW"]),
    type: z.enum(["MARKET", "LIMIT"]),
    status: z.enum(["OPEN", "FILLED", "PARTIALLY_FILLED", "CANCELLED"]),
    originalAmount: z.string().regex(/^\d+$/).max(40),
    remainingAmount: z.string().regex(/^\d+$/).max(40),
    settlementFeeAmount: z.string().regex(/^\d+$/).max(40),
    rate: z.number().int().min(0).max(10000).optional(),
});

private handleOrderCreation(raw: unknown, subject: string) {
    const parsed = OrderCreationMessage.safeParse(raw);
    if (!parsed.success) {
        this.logger.warn(`Dropping malformed orders.* message on ${subject}: ${parsed.error.message}`);
        return;
    }
    const msg = parsed.data;
    // ... existing logic
}
```

### 5. Cross-check against DB before broadcasting user-scoped data

Already partially done via `fetchActiveOrderIds` for orderbook aggregation. Extend it: before emitting `active-positions` or `open-positions`, confirm `orderId` exists in the DB and its `account_id` matches `msg.accountId`. This means a forged NATS message can't make the gateway leak data for a real victim — at worst it injects garbage that's filtered out.

```typescript
private async emitUserPosition(tracked: TrackedOrder, subject: string) {
    const real = await this.orderRepository.findOrderForTracking(tracked.orderId);
    if (!real || real.accountId !== tracked.accountId) {
        this.logger.warn(`Dropping NATS message for unknown/mismatched order ${tracked.orderId}`);
        return;
    }
    // ... emit
}
```

(Costs an extra DB read per event; cache for 1–5 s if volume is high.)

## Verification

```bash
# 1. NATS auth required
nats sub --server nats://nats-host:4222 "orders.>"
# Expected: "nats: authorization violation"

nats sub --server nats://wrong:wrong@nats-host:4222 "orders.>"
# Expected: "nats: authorization violation"

# 2. Subject restriction works
nats pub --server nats://backend:pwd@nats-host:4222 "matches.created" '{"foo":1}'
# Expected: "permissions violation"

# 3. Schema validation drops garbage (in unit test)
gateway.handleOrdersMessage({foo:"bar"}, "orders.lend.created");
expect(loggerWarn).toHaveBeenCalledWith(/malformed/);
```

## References

- [NATS authentication](https://docs.nats.io/running-a-nats-service/configuration/securing_nats/auth_intro)
- [NATS authorization (subject permissions)](https://docs.nats.io/running-a-nats-service/configuration/securing_nats/authorization)
- [OWASP A04:2021 — Insecure Design](https://owasp.org/Top10/A04_2021-Insecure_Design/)
- [CWE-940](https://cwe.mitre.org/data/definitions/940.html)
