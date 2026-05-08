# F-15: WebSocket gateway has no authentication — cross-user data leak

**Severity**: 🔴 Critical
**OWASP**: A01 Broken Access Control, A07 Identification & Auth Failures
**CWE**: CWE-862 (Missing Authorization), CWE-200 (Sensitive Information Exposure)

## Summary

The Socket.IO `EventsGateway` accepts connections without authentication and lets any client join an arbitrary `user:<accountId>` room by sending the victim's `accountId` as a subscribe payload. Once joined, the client receives every position update for that victim — wallet address, order amounts, rates, fills — in real time.

CORS is also set to `*` outside of production, so any web origin can open this socket.

## Evidence

`src/core/websocket/websocket.gateway.ts`:

```typescript
const websocketCorsOrigin =
    process.env.NODE_ENV === "production"
        ? (process.env.WS_CORS_ORIGINS ?? "").split(",")...
        : "*";   // ⚠️ wildcard origin in dev/staging/test

@WebSocketGateway({ cors: { origin: websocketCorsOrigin } })
export class EventsGateway ... {
    handleConnection(client: Socket) {
        this.logger.log(`Client connected: ${client.id}`);  // ⚠️ no auth check
    }

    @SubscribeMessage("active-positions")
    handleActivePosition(
        @ConnectedSocket() client: Socket,
        @MessageBody() body: UserPositionsDto,  // ⚠️ user-supplied
    ) {
        const room = `user:${body.accountId}`;
        client.join(room);  // ⚠️ no check that body.accountId == authenticated user
        return { success: true, room };
    }

    @SubscribeMessage("open-positions")
    handleOpenPosition(
        @ConnectedSocket() client: Socket,
        @MessageBody() body: UserPositionsDto,
    ) {
        const room = `user:${body.accountId}`;
        client.join(room);  // ⚠️ same issue
        return { success: true, room };
    }
}
```

The corresponding emit:

```typescript
private emitUserPosition(tracked: TrackedOrder, subject: string) {
    const room = `user:${tracked.accountId}`;
    const payload = {
        order: this.toOrderPayload(tracked),  // includes walletAddress, amounts, rate
        subject,
    };
    this.server.to(room).emit("active-positions", payload);
    this.server.to(room).emit("open-positions", payload);
}
```

`toOrderPayload` exposes:
- `walletAddress`, `accountId`
- `originalAmount`, `remainingAmount`, `settlementFeeAmount`
- `rate`, `assetId`, `markets`, `side`, `type`, `status`

## Impact

- **F-15.1 — Position-level surveillance**: an attacker can target any user with a known `accountId` and stream every order they place, modify, fill, or cancel. This is competitive intelligence gold for any market-making opponent.
- **F-15.2 — Wallet address leak**: even if the attacker only knows `accountId`, the broadcast payload contains `walletAddress`, breaking the link between the public account ID and the on-chain identity.
- **F-15.3 — Combined with NATS subscriptions** (`orders.>`, `matches.>`): the gateway re-emits every order creation and match. An attacker can passively observe market structure and front-run.
- **F-15.4 — `accountId` is enumerable**: it appears in `matches.created` events (subscribed publicly) and order broadcasts, so attackers can harvest IDs from public traffic.
- **F-15.5 — Wildcard CORS in dev/staging**: any malicious site a user visits can connect to staging WS and exfiltrate from a logged-in tab.

## Reproduction

```javascript
// From any browser console (e.g. https://evil.example):
const sock = io("http://localhost:8080");
sock.on("connect", () => {
    // No auth required. Pick any victim's accountId.
    sock.emit("active-positions", {
        accountId: "f88e0d1a-62c5-40b0-a79a-a6818effb33b"  // victim
    });
});
sock.on("active-positions", (msg) => console.log("LEAK:", msg));
sock.on("open-positions", (msg) => console.log("LEAK:", msg));
// Now every order placed/cancelled by the victim streams here.
```

## Recommended Solution

### 1. Authenticate the WebSocket handshake

`src/core/websocket/websocket.gateway.ts`:

```typescript
import { AuthStrategyFactory } from "../../common/guards/strategies/auth-strategy.factory";

@WebSocketGateway({
    cors: { origin: websocketCorsOrigin },
    maxHttpBufferSize: 1024 * 1024,  // 1MB cap (also addresses F-11)
})
export class EventsGateway implements OnGatewayConnection, ... {
    constructor(
        // ... existing
        private readonly authStrategyFactory: AuthStrategyFactory,
    ) {}

    async handleConnection(client: Socket) {
        try {
            const token =
                (client.handshake.auth?.token as string | undefined) ??
                (client.handshake.headers.authorization?.replace(/^Bearer\s+/i, ""));

            if (!token) {
                client.disconnect(true);
                return;
            }

            const strategy = this.authStrategyFactory.getStrategy(token);
            const user = await strategy.validate(token);

            // Resolve accountId from walletAddress so room name is server-derived
            const account = await this.orderRepository.findAccountByWallet(user.walletAddress);
            if (!account) {
                client.disconnect(true);
                return;
            }

            // Stash on the socket for later authz checks
            (client.data as any).user = { ...user, accountId: account.id };

            this.logger.log(`Client connected: ${client.id} as ${account.id}`);
        } catch (err) {
            this.logger.warn(`WS auth failed: ${(err as Error).message}`);
            client.disconnect(true);
        }
    }
}
```

### 2. Server-derived room names — never trust client-supplied accountId

```typescript
@SubscribeMessage("active-positions")
handleActivePosition(@ConnectedSocket() client: Socket) {
    const accountId = (client.data as any).user?.accountId;
    if (!accountId) {
        return { success: false, error: "Unauthorized" };
    }
    const room = `user:${accountId}`;  // 🔒 from authenticated session, not body
    client.join(room);
    return { success: true, room };
}

@SubscribeMessage("open-positions")
handleOpenPosition(@ConnectedSocket() client: Socket) {
    const accountId = (client.data as any).user?.accountId;
    if (!accountId) {
        return { success: false, error: "Unauthorized" };
    }
    client.join(`user:${accountId}`);
    return { success: true };
}
```

Drop `UserPositionsDto` entirely — clients should not be passing `accountId`.

### 3. Lock down CORS in non-prod

```diff
  const websocketCorsOrigin =
      process.env.NODE_ENV === "production"
          ? (process.env.WS_CORS_ORIGINS ?? "").split(",")...
-         : "*";
+         : (process.env.WS_CORS_ORIGINS ?? "http://localhost:3000")
+               .split(",")
+               .map((o) => o.trim())
+               .filter(Boolean);
```

Even a curated list (e.g. `localhost:3000`, internal staging FE) is far safer than `*`.

### 4. Defense in depth — connection rate limit per IP

```typescript
private readonly maxClientsPerIp = 10;
private readonly clientsByIp = new Map<string, Set<string>>();

async handleConnection(client: Socket) {
    const ip = client.handshake.address;
    const existing = this.clientsByIp.get(ip) ?? new Set();
    if (existing.size >= this.maxClientsPerIp) {
        client.disconnect(true);
        return;
    }
    existing.add(client.id);
    this.clientsByIp.set(ip, existing);
    // ... auth
}

handleDisconnect(client: Socket) {
    for (const [ip, ids] of this.clientsByIp) {
        if (ids.delete(client.id) && ids.size === 0) {
            this.clientsByIp.delete(ip);
        }
    }
}
```

### 5. Don't broadcast walletAddress in the user-room payload

The user already knows their own wallet — including it in the WS payload only creates an attack surface if room scoping ever fails. Strip it:

```typescript
private toOrderPayload(tracked: TrackedOrder) {
    return {
        orderId: tracked.orderId,
        // walletAddress: tracked.walletAddress,   // ⚠️ remove
        // accountId: tracked.accountId,           // ⚠️ remove
        assetId: tracked.assetId,
        markets: tracked.markets,
        // ... rest
    };
}
```

## Verification

```javascript
// Without auth → disconnected
const sock1 = io("http://localhost:8080");
sock1.on("disconnect", (reason) => console.log("Expected disconnect:", reason));

// With valid auth, but trying to spy on another accountId — server ignores body
const sock2 = io("http://localhost:8080", {
    auth: { token: "DEV_TOKEN_0xMY_OWN_WALLET..." }
});
sock2.emit("active-positions", { accountId: "<victim_account_id>" });
sock2.on("active-positions", (msg) => console.log(msg));
// Expected: only msg for sock2's own accountId arrive
```

## References

- [Socket.IO middleware authentication](https://socket.io/docs/v4/middlewares/)
- [OWASP A01:2021 — Broken Access Control](https://owasp.org/Top10/A01_2021-Broken_Access_Control/)
- [Real-world: Slack WebSocket cross-tenant leak (HackerOne 2018)](https://hackerone.com/reports/388783)
