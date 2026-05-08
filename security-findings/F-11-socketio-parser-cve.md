# F-11: `socket.io-parser` unbounded binary attachments

**Severity**: 🟡 Moderate (the codebase uses a websocket gateway)
**OWASP**: A04 Insecure Design, A06 Vulnerable Components
**CVE/GHSA**: GHSA-677m-j7p3-52f9

## Summary

`socket.io-parser@4.2.5` allows an unbounded number of binary attachments → memory exhaustion DoS. The codebase has a `WebsocketGateway` in `src/core/websocket/`, so this is relevant.

## Evidence

```bash
$ pnpm audit | grep socket.io-parser
high  socket.io allows an unbounded number of binary attachments
```

`src/core/websocket/websocket.gateway.ts` exists.

## Impact

- An attacker connects to the websocket and sends a message with thousands of binary attachment fields → server OOM.
- Combined with F-2 (no rate limit), a single attacker can take the server down.

## Recommended Solution

### 1. Update transitive

```bash
pnpm update socket.io socket.io-parser
```

`package.json`:
```json
{
  "pnpm": {
    "overrides": {
      "socket.io-parser": "^4.2.6"
    }
  }
}
```

### 2. Add connection limits to the websocket gateway

`src/core/websocket/websocket.gateway.ts`:

```typescript
import { WebSocketGateway, OnGatewayConnection } from "@nestjs/websockets";

@WebSocketGateway({
    cors: { origin: process.env.CORS_ORIGINS?.split(",") || [] },
    maxHttpBufferSize: 1024 * 1024,  // 1MB max per message
    pingTimeout: 30000,
    pingInterval: 25000,
})
export class WebsocketGateway implements OnGatewayConnection {
    private readonly maxClientsPerIp = 5;
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
    }

    async handleDisconnect(client: Socket) {
        // cleanup
    }
}
```

### 3. Authentication on websocket

Make sure websocket connections are authenticated — don't expose them publicly:

```typescript
@SubscribeMessage("subscribe")
async handleSubscribe(client: Socket, data: any) {
    const user = await this.authService.verifyWsToken(client.handshake.auth.token);
    if (!user) { client.disconnect(); return; }
    // ...
}
```

## Verification

```bash
pnpm audit | grep socket.io-parser
# Expected: empty
```

## References

- [GHSA-677m-j7p3-52f9](https://github.com/advisories/GHSA-677m-j7p3-52f9)
