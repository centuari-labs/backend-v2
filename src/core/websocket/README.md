# WebSocket Gateway

Real-time WebSocket gateway that bridges NATS events from the matching engine to Socket.IO clients, enabling live orderbook updates and user-specific position tracking.

## Architecture

```
Matching Engine → NATS → WebSocket Gateway → Socket.IO rooms → Clients
```

**Components:**

- **NatsService** — subscribes to matching engine events
- **EventsGateway** — manages Socket.IO connections, rooms, and caching
- **Orderbook cache** — in-memory latest snapshot per market (loanToken + maturity)

## Data Flow

### Orderbook Updates

```
1. Order submitted/cancelled in matching engine
2. Matching engine publishes best bid/ask to NATS topic "orderbook.snapshot"
   - One message per affected maturity
   - Contains best order per side (depth=1): price (basis points), apr, amount
3. Gateway receives snapshot, transforms price from basis points → percentage
4. Gateway caches the transformed snapshot keyed by room
5. Gateway emits "orderbook-update" to room "orderbook:{loanToken}:{maturity}"
```

### Position Updates

```
1. Matching engine publishes order status to NATS topic "orders.>"
2. Gateway receives and routes:
   - Filled orders → emit "active-positions" to room "user:{accountId}"
   - Open/PartiallyFilled limit orders → emit "open-positions" to room "user:{accountId}"
```

## NATS Topics

| Topic | Direction | Description |
|-------|-----------|-------------|
| `orderbook.snapshot` | Subscribe | Best bid/ask per market from matching engine |
| `orders.>` | Subscribe | Order status updates (wildcard for all order topics) |

## Socket.IO Events

### Client → Server

#### Subscribe to Orderbook

```typescript
socket.emit('subscribe-orderbook', {
  loanToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  maturity: 1735689600
});
// Response: { success: true, room: 'orderbook:0xA0b8...eB48:1735689600' }
// Immediately receives cached snapshot if available
```

#### Unsubscribe from Orderbook

```typescript
socket.emit('unsubscribe-orderbook', {
  loanToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  maturity: 1735689600
});
// Response: { success: true, room: 'orderbook:0xA0b8...eB48:1735689600' }
```

#### Subscribe to Positions

```typescript
// Active (filled) positions
socket.emit('active-positions', { accountId: 'account-123' });
// Response: { success: true, room: 'user:account-123' }

// Open positions
socket.emit('open-positions', { accountId: 'account-123' });
// Response: { success: true, room: 'user:account-123' }
```

### Server → Client

#### `orderbook-update`

Emitted to room `orderbook:{loanToken}:{maturity}` on every orderbook change and immediately on subscription (from cache).

```typescript
socket.on('orderbook-update', (data) => {
  // data:
  // {
  //   loanToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  //   maturity: 1735689600,
  //   lend: { price: 5.0, apr: '-', amount: '1000000' } | null,
  //   borrow: { price: 7.5, apr: '-', amount: '500000' } | null,
  //   timestamp: 1704067200000
  // }
});
```

| Field | Type | Description |
|-------|------|-------------|
| `loanToken` | `string` | Token contract address |
| `maturity` | `number` | Maturity timestamp (seconds) |
| `lend` | `object \| null` | Best lend order, or null if no lend orders |
| `lend.price` | `number` | Interest rate as percentage (e.g., `5.0` = 5%) |
| `lend.apr` | `string` | APR — `"-"` placeholder for now |
| `lend.amount` | `string` | Remaining amount in base units |
| `borrow` | `object \| null` | Best borrow order, or null if no borrow orders |
| `timestamp` | `number` | Server timestamp (milliseconds) |

> **Note:** The matching engine publishes price in basis points (e.g., 500 = 5%). The gateway converts to percentage before sending to clients.

#### `active-positions`

Emitted to room `user:{accountId}` when an order is filled.

```typescript
socket.on('active-positions', (data) => {
  // data: { order: Order, subject: string }
});
```

#### `open-positions`

Emitted to room `user:{accountId}` when a limit order is open or partially filled.

```typescript
socket.on('open-positions', (data) => {
  // data: { order: Order, subject: string }
});
```

## Room Management

| Room Pattern | Example | Used For |
|-------------|---------|----------|
| `orderbook:{loanToken}:{maturity}` | `orderbook:0xA0b8...eB48:1735689600` | Orderbook updates |
| `user:{accountId}` | `user:account-123` | Position updates |

## Caching

The gateway caches the latest `orderbook-update` payload per room key. When a new client subscribes, it immediately receives the cached snapshot without waiting for the next NATS event.

Cache is in-memory and resets on server restart.

## Files

| File | Description |
|------|-------------|
| `websocket.gateway.ts` | Gateway — NATS subscriptions, room management, broadcasting |
| `dto/orderbook.dto.ts` | TypeScript interfaces for orderbook payloads |
| `dto/user.dto.ts` | TypeScript interfaces for user position payloads |

## Registration

The gateway is registered as a provider in `AppModule`:

```typescript
// app.module.ts
providers: [EventsGateway],
```

It depends on `NatsService` from `CoreModule` (imported via `imports`).

## Client Example

```typescript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000');

socket.on('connect', () => {
  // Subscribe to USDC orderbook for a specific maturity
  socket.emit('subscribe-orderbook', {
    loanToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    maturity: 1735689600,
  });
});

socket.on('orderbook-update', (data) => {
  console.log('Best lend:', data.lend);   // { price: 5.0, apr: '-', amount: '1000000' }
  console.log('Best borrow:', data.borrow); // { price: 7.5, apr: '-', amount: '500000' }
});

// Cleanup
socket.emit('unsubscribe-orderbook', {
  loanToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  maturity: 1735689600,
});
```

## Testing

```bash
npx jest --testPathPatterns="websocket"
```

17 tests covering: initialization, NATS subscriptions, room join/leave, orderbook broadcasting with price transformation, null side handling, cache behavior, multi-room management, and error handling.

## CORS

Configured via `WS_CORS_ORIGINS` environment variable (comma-separated origins). Defaults to `*` in non-production environments.
