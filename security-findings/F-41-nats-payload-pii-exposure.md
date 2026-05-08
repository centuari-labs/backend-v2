# F-41: NATS payloads expose `walletAddress` and order amounts in plaintext on a shared bus

**Severity**: 🟠 High (privacy / market intelligence)
**OWASP**: A02 Cryptographic Failures (in transit), A04 Insecure Design
**CWE**: CWE-200 (Sensitive Information Exposure to an Unauthorized Actor), CWE-359 (Exposure of Private Personal Information)

## Summary

Every order publishes a `MatchingEngineOrderPayload` to a NATS subject. The payload includes the user's full `walletAddress`, every market they're targeting, the loan token, the order side/type/status, and base-unit amounts (original / remaining / settlement-fee). Cancel events publish `walletAddress` too. Subjects are flat (no per-user / per-tenant scoping), and the NATS server runs without authentication or transport encryption (per **F-18**).

Anyone who can connect to NATS — currently anyone on the host network because port `4222` is published on `0.0.0.0` — can subscribe to `orders.>` and `matches.>` and receive a real-time feed of every wallet's trading activity. This is competitive-intelligence gold for any market-making opponent and a deanonymization tool for any user who tries to keep their on-chain wallet unlinked to their identity.

The same payload also flows into `EventsGateway.toOrderPayload` and is broadcast to user-room websocket clients (per **F-15**, those rooms are spoofable). Even fixing F-15 / F-18 doesn't change the fact that the *protocol-internal* messages are dragnet-style: the matching engine, settlement engine, gateway, and any future internal subscriber sees every user's full position.

## Evidence

### NATS subjects are flat per side/type

`src/orders/constants/nats-subjects.constants.ts`:

```typescript
export const NATS_SUBJECTS = {
    LEND_MARKET: "orders.lend.market",
    LEND_LIMIT: "orders.lend.limit",
    BORROW_MARKET: "orders.borrow.market",
    BORROW_LIMIT: "orders.borrow.limit",
    CANCEL: "orders.cancel",
    MATCH_CREATED: "matches.created",
    UPDATE: "orders.update",
} as const;
```

A subscriber to `orders.>` receives **every** order from **every** user.

### Payload shape — `walletAddress` included

`src/orders/orders.service.ts:59-74`:

```typescript
interface MatchingEngineOrderPayload {
    orderId: string;
    walletAddress: string;            // ⚠️ user's full wallet
    loanToken: string;
    assetId: string;
    markets: { marketId: string; maturity: number }[];
    timestamp: number;
    side: OrderSide;
    type: OrderType;
    status: OrderStatus;
    originalAmount: string;           // ⚠️ position size
    remainingAmount: string;
    settlementFeeAmount: string;
    remainingSettlementFeeAmount: string;
    rate?: number;
}
```

Cancel events (`publishCancelOrderToNats` in `orders.service.ts`) emit `{ orderId, walletAddress }` — the wallet is there too.

`OrderCreationMessage` and `OrderCancelMessage` types in the gateway confirm the same shape lands at the WS layer:

```typescript
interface OrderCreationMessage {
    orderId: string;
    walletAddress: string;
    loanToken: string;
    assetId?: string;
    markets: Array<{ marketId: string; maturity: number }>;
    side: OrderSide;
    ...
}
```

### NATS without auth or TLS

`src/core/nats/nats.service.ts:30-38`:

```typescript
const options: ConnectionOptions = {
    servers: this.natsUrl,
    maxReconnectAttempts: -1,
    reconnectTimeWait: 1000,
    name: "centuari-backend",
};
this.connection = await connect(options);
// ⚠️ no user/pass, no TLS
```

Boot script: `docker run -d --name nats -p 4222:4222 -p 8222:8222 nats:2.10 -js`. Port `4222` published to all interfaces.

## Impact

- **F-41.1 — Wallet-level surveillance**: any LAN-adjacent attacker (CI runner on the same network, neighboring container, dev laptop on the same VPN) connects to NATS and observes every order. Real-time mapping of `walletAddress → trading behavior`. Competitive opponents get a free transparent orderbook with attribution.
- **F-41.2 — Privacy leak across the user base**: many users assume "my Privy wallet is mine; only the protocol sees my exact balances and orders." The protocol-internal bus broadcasts that information unencrypted to every internal subscriber and any unauthenticated joiner.
- **F-41.3 — Front-running**: an observer of `orders.lend.limit` events can place opposing orders before the matching engine matches them, knowing the rate, side, asset, and amount. Combined with F-29 (no balance check), an attacker doesn't even need real funds for the opposing leg.
- **F-41.4 — Combined with F-15 (WS no auth)**: the same payload is broadcast to `user:<accountId>` rooms, but with the `accountId` controlled by the subscribing client. So even without NATS access, an attacker who knows `accountId`s (which appear in match events) can collect the same data via WS.
- **F-41.5 — TLS-less transport**: even with auth added on the NATS layer (per F-18 fix), packet capture between the backend and NATS still reads the plaintext payloads unless TLS is enabled.
- **F-41.6 — Audit / regulatory exposure**: depending on jurisdiction, exposure of trade-level data plus attribution may breach financial-privacy or data-protection rules (MiCA, MAS DT-PSO, GDPR Article 32 "appropriate technical and organisational measures").

## Reproduction

```bash
# Adjacent host to the backend (or the same host today, since port is on 0.0.0.0):
nats sub --server nats://localhost:4222 "orders.>" "matches.>"

# Output, in real time:
# [#1] Received on "orders.lend.limit"
#  {"orderId":"...","walletAddress":"0xVICTIM...","assetId":"...","markets":[...],
#   "originalAmount":"100000000","rate":500, ...}
# [#2] Received on "orders.cancel"
#  {"orderId":"...","walletAddress":"0xVICTIM..."}
# [#3] Received on "matches.created"
#  {"assetId":"...","rate":495,"amount":"50000000",...}
```

## Recommended Solution

The NATS auth + TLS work in F-18 closes the unauthenticated subscriber. This finding adds two independent hardening axes:

### 1. Don't put PII / position sizes on a flat subject

Even with NATS auth, the payload should be the minimum needed for downstream services. The matching engine needs `accountId` (an opaque UUID), not `walletAddress`. The on-chain settlement step can join `accounts.user_wallet` server-side after a match, in the locked / authorized path.

```typescript
interface MatchingEngineOrderPayload {
    orderId: string;
    accountId: string;              // ⬅ replaces walletAddress
    loanToken: string;
    assetId: string;
    markets: { marketId: string; maturity: number }[];
    timestamp: number;
    side: OrderSide;
    type: OrderType;
    status: OrderStatus;
    originalAmount: string;
    remainingAmount: string;
    settlementFeeAmount: string;
    remainingSettlementFeeAmount: string;
    rate?: number;
}
```

Audit every NATS publish for sensitive fields:

```bash
$ grep -rn "natsService.publish\|publish(" src --include="*.ts" | grep -v "test\|spec"
# For each, confirm the payload doesn't include walletAddress, full PII, or anything
# beyond what the consumer strictly needs.
```

The websocket gateway, which currently re-emits the same payload to user rooms, should also be reduced to the minimum. (Already covered in F-15 §5 — the recommendation here matches.)

### 2. Per-account subjects + subject-level authorization

Even with the slim payload, place per-user data on a per-user subject so a future bug doesn't accidentally publish across users:

```typescript
const subject = `orders.${side}.${type}.${accountId}`;
await this.natsService.publish(subject, payload);
```

NATS subject permissions (per F-18) can then restrict each subscriber:

```yaml
authorization {
    users = [
        { user: matcher, password: "...", permissions: { subscribe: ["orders.>", "matches.created"] } }
        { user: gateway, password: "...", permissions: { subscribe: ["orders.>", "matches.created"] } }
        { user: settler, password: "...", permissions: { subscribe: ["matches.created"] } }
    ]
}
```

External / leaked credentials are scoped by subject pattern, not by "all of orders.>".

### 3. Encrypt sensitive payloads end-to-end

If the payload genuinely needs sensitive fields (e.g. settlement engine needs the wallet), encrypt the payload with a key shared between the publisher and the intended consumer:

```typescript
import { createCipheriv, randomBytes } from "node:crypto";
const SETTLEMENT_KEY = Buffer.from(process.env.NATS_PAYLOAD_KEY!, "hex"); // 32 bytes

function sealForSettler(payload: object): Buffer {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", SETTLEMENT_KEY, iv);
    const ct = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ct]);
}

await this.natsService.publish("settlement.requests", sealForSettler({...}));
```

Subscribers without the key see encrypted blobs only. Combined with §1 / §2, this gives defense in depth.

### 4. NATS TLS

In production, run NATS with TLS:

```yaml
# nats-server.conf
tls {
    cert_file: "/etc/nats/server-cert.pem"
    key_file:  "/etc/nats/server-key.pem"
    ca_file:   "/etc/nats/ca.pem"
    verify_and_map: true       # require client cert
    timeout: 5
}
```

Backend connection:

```typescript
const options: ConnectionOptions = {
    servers: this.natsUrl,
    tls: {
        keyFile: process.env.NATS_TLS_KEY,
        certFile: process.env.NATS_TLS_CERT,
        caFile: process.env.NATS_TLS_CA,
    },
    user: process.env.NATS_USER,
    pass: process.env.NATS_PASSWORD,
};
```

Closes the packet-capture path even on a shared private network.

### 5. Audit logging — no leaking via logs

`NatsService.publish` already does `this.logger.debug('Published to ${subject}: ${payload}')` — that prints the entire payload at DEBUG. If `LOG_LEVEL=debug` is ever on in production, every order's PII lands in stdout / log shipper / search index. Either:

- Mask `walletAddress` and amounts in the debug print, or
- Switch to `this.logger.debug('Published to ${subject} (${payload.length} bytes)')` and keep the body out of logs.

## Verification

```bash
# 1. Subject-scoped subscribe permission
nats sub --server nats://settler:pwd@nats:4222 "orders.>"
# Expected: "permissions violation".

# 2. Per-account subject works
nats sub --server nats://gateway:pwd@nats:4222 "orders.lend.limit.<accountId-A>"
# Receives only A's orders.

# 3. Payload doesn't include walletAddress
const captured = await captureNatsMessage("matches.created");
expect(captured).not.toHaveProperty("walletAddress");

# 4. TLS required
openssl s_client -connect nats:4222 -tls1_2 < /dev/null
# Expected: handshake succeeds with TLS server hello.

curl http://nats:4222
# Expected: connection refused / cleartext rejected.

# 5. Logs scrubbed
LOG_LEVEL=debug pnpm run start:dev
curl ...
docker logs backend | grep -E "0x[a-fA-F0-9]{40}"
# Expected: no full wallet addresses; only masked forms (`0x1234…abcd`).
```

## References

- [NATS authorization](https://docs.nats.io/running-a-nats-service/configuration/securing_nats/authorization)
- [NATS TLS](https://docs.nats.io/running-a-nats-service/configuration/securing_nats/tls)
- [OWASP API Security: Excessive Data Exposure](https://owasp.org/API-Security/editions/2019/en/0xa3-excessive-data-exposure/)
- [GDPR Article 32 — Security of processing](https://gdpr-info.eu/art-32-gdpr/)
- [MiCA — market integrity for crypto trading systems](https://www.esma.europa.eu/publications-and-data/library/markets-crypto-assets-mica)
- Real-world: [Solana validator MEV / order-flow surveillance via shared messaging (2023)](https://blog.openzeppelin.com/secure-mev-on-solana/) — analogous problem
