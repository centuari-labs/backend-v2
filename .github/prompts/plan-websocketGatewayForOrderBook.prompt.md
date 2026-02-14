# Plan: WebSocket Gateway for Order Book

Create a real-time WebSocket gateway that bridges the matching engine's NATS events with Socket.IO clients, enabling live order book updates, match notifications, and user-specific order status changes.

## Steps

1. **Enhance websocket.gateway.ts** with room management, client subscription handlers (`subscribe-orderbook`, `unsubscribe-orderbook`, `subscribe-user-orders`), connection/disconnection logging, and authentication via `PrivyGuard`

2. **Create NATS subscription handlers** in websocket.gateway.ts using `NatsService.subscribe()` for `matches.created`, `orders.status`, `orderbook.snapshot`, and `orders.error` topics from the matching engine

3. **Implement broadcasting logic** to emit NATS events to appropriate Socket.IO rooms: orderbook snapshots to `orderbook:{loanToken}:{maturity}` rooms, match notifications to relevant rooms, user order updates to `user:{accountId}` rooms

4. **Add order book state caching** (optional) to store latest snapshots per token/maturity, enabling immediate snapshot delivery to newly subscribed clients without waiting for matching engine updates

5. **Create DTO types** for WebSocket payloads (OrderBookSnapshotDto, MatchNotificationDto, OrderStatusUpdateDto) to ensure type-safe client-server communication

## Further Considerations

1. **Authentication Strategy**: Should clients authenticate via JWT token in connection handshake, or allow anonymous subscriptions for public order book with authenticated subscriptions only for user-specific orders?

2. **Throttling/Batching**: Should high-frequency order book updates be debounced/throttled (e.g., max 10 updates/second per room) to prevent overwhelming clients, or send every update in real-time?

3. **Initial Snapshot Delivery**: Should the gateway request order book snapshots from the matching engine on-demand when clients subscribe, or wait for the next periodic snapshot broadcast?

## Research Context

### Matching Engine Communication Architecture

#### Communication Protocol: NATS Message Broker
The matching engine is a separate service that communicates with this backend via NATS pub/sub messaging.

#### NATS Topics Flow

**Backend → Matching Engine (Published by Backend):**
- `orders.lend.market` - Lend market orders
- `orders.lend.limit` - Lend limit orders  
- `orders.borrow.market` - Borrow market orders
- `orders.borrow.limit` - Borrow limit orders
- `orders.cancel` - Order cancellation requests

**Matching Engine → Backend (Should Subscribe to):**
- `matches.created` - Match results after order processing (contains `orderId`, `matches[]`, `remainingOrder`)
- `orders.status` - Order status updates
- `orderbook.snapshot` - Order book snapshots
- `orders.error` - Error notifications with standardized error codes

### Current Order Structure & Entities

#### Order Entity
```typescript
{
  id: string;                    // UUID
  accountId: string;             // Foreign key to Account
  assetId: string;               // Foreign key to Token
  side: OrderSide;               // "LEND" | "BORROW"
  type: OrderType;               // "MARKET" | "LIMIT"
  rate: number;                  // Basis points (e.g., 500 = 5%)
  quantity: string;              // Numeric string
  filledQuantity: string;        // Numeric string (default 0)
  settlementFee: string;         // Numeric string
  status: OrderStatus;           // "OPEN" | "FILLED" | "CANCELLED" | "PARTIALLY_FILLED"
  createdAt: Date;
  updatedAt: Date;
}
```

#### Account Entity
```typescript
{
  id: string;
  privyUserId: string;
  userWallet: string;
  createdAt: Date;
}
```

#### Token/Asset Entity
```typescript
{
  id: string;
  tokenAddress: string;
  symbol: string;
  name: string;
  imageUrl: string;
  isLoanToken: boolean;
  LLTV: number;  // Liquidation Loan-to-Value
  LT: number;    // Liquidation Threshold
  LP: number;    // Liquidation Penalty
  createdAt: Date;
  updatedAt: Date;
}
```

### NATS Service Capabilities

```typescript
class NatsService {
  // Core methods
  publish(subject: string, data: unknown): Promise<void>
  subscribe<T>(subject: string, callback: (data: T) => void | Promise<void>): Promise<void>
  isConnected(): boolean
  getConnection(): NatsConnection | null
  
  // Configuration
  - NATS_URL: process.env.NATS_URL || "nats://localhost:4222"
  - Auto-reconnect: maxReconnectAttempts: -1 (infinite)
  - Reconnect wait: 1000ms
  - Connection name: "centuari-backend"
}
```

### Current WebSocket Gateway State

```typescript
@WebSocketGateway({
  cors: { origin: '*' }
})
class EventsGateway {
  @WebSocketServer() server: Server;
  
  // Example handlers (not order-book related)
  @SubscribeMessage('events')
  findAll(@MessageBody() data: any): Observable<WsResponse<number>>
  
  @SubscribeMessage('identity')
  async identity(@MessageBody() data: number): Promise<number>
}
```

**Current State:**
- ✅ Basic Socket.IO gateway configured
- ✅ CORS enabled (origin: '*')
- ✅ Server instance available for broadcasting
- ❌ No integration with NATS
- ❌ No order book subscriptions
- ❌ No real-time order updates
- ❌ Only has dummy/example handlers

### Expected Message Formats

**matches.created Response:**
```typescript
{
  orderId: string;
  matches: Match[];
  remainingOrder?: Order;  // If partially filled
}
```

**orders.status Response:**
```typescript
{
  orderId: string;
  status: OrderStatus;
  filledQuantity?: string;
}
```

**orderbook.snapshot Response:**
```typescript
{
  loanToken: string;
  maturity: number;
  lendOrders: Order[];
  borrowOrders: Order[];
}
```

**orders.error Response:**
```typescript
{
  orderId?: string;
  errorCode: string;  // VALIDATION_ERROR, INVALID_ORDER, etc.
  message: string;
}
```

### Error Codes from Matching Engine

- `VALIDATION_ERROR` - Invalid order data
- `INVALID_ORDER` - Business rule violations
- `ORDER_NOT_FOUND` - Order doesn't exist
- `RATE_MISMATCH` - Rate matching issues
- `INSUFFICIENT_LIQUIDITY` - No matching orders
- `INTERNAL_ERROR` - Service errors
- `NATS_CONNECTION_ERROR` - Connection issues
- `MESSAGE_PARSE_ERROR` - JSON parsing failures

### Order Book Data Structure

```
Map<loanToken, Map<maturity, RBTree<Order>>>
  └─ Each token has multiple maturities
     └─ Each maturity has a sorted tree of orders
        └─ Sorted by rate (price) and timestamp
```

### Matching Algorithm Characteristics

- **Price-Time Priority**: Best price first, then earliest timestamp
- **Data Structure**: Red-Black Trees (O(log n) operations)
- **Order Flow**:
  1. Backend publishes order → NATS
  2. Matching engine receives → validates → matches
  3. Matching engine creates matches → updates order book
  4. Matching engine publishes results → NATS
  5. Backend should subscribe and process results
