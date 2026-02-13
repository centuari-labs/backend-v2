# WebSocket Gateway for Order Book

Real-time WebSocket gateway that bridges the matching engine's NATS events with Socket.IO clients, enabling live order book updates, match notifications, and user-specific order status changes.

## Architecture

```
Matching Engine (NATS) → WebSocket Gateway → Socket.IO → Clients
```

### Components

- **NATS Service**: Subscribes to matching engine events
- **WebSocket Gateway**: Manages Socket.IO connections and rooms
- **Order Book Cache**: In-memory snapshot storage
- **Room Management**: Token/maturity-specific and user-specific rooms

## NATS Topics

### Subscribed Topics (from Matching Engine)

| Topic | Description | Data Type |
|-------|-------------|-----------|
| `orderbook.snapshot` | Full/partial order book state | `OrderBookSnapshotDto` |
| `matches.created` | Match results after order processing | `MatchNotificationDto` |
| `orders.status` | Order status updates | `OrderStatusUpdateDto` |
| `orders.error` | Error notifications | `OrderErrorDto` |

## Socket.IO Events

### Client → Server (Subscribe/Unsubscribe)

#### Subscribe to Order Book
```typescript
socket.emit('subscribe-orderbook', {
  loanToken: 'USDC',
  maturity: 1234567890
});
// Response: { success: true, room: 'orderbook:USDC:1234567890' }
```

#### Unsubscribe from Order Book
```typescript
socket.emit('unsubscribe-orderbook', {
  loanToken: 'USDC',
  maturity: 1234567890
});
// Response: { success: true, room: 'orderbook:USDC:1234567890' }
```

#### Subscribe to User Orders
```typescript
socket.emit('subscribe-user-orders', {
  accountId: 'account-123'
});
// Response: { success: true, room: 'user:account-123' }
```

#### Unsubscribe from User Orders
```typescript
socket.emit('unsubscribe-user-orders', {
  accountId: 'account-123'
});
// Response: { success: true, room: 'user:account-123' }
```

### Server → Client (Broadcasts)

#### Order Book Updates
```typescript
socket.on('orderbook-update', (data: OrderBookSnapshotDto) => {
  console.log('Lend Orders:', data.lendOrders);
  console.log('Borrow Orders:', data.borrowOrders);
});
```

**Data Structure:**
```typescript
{
  loanToken: string;
  maturity: number;
  lendOrders: Order[];
  borrowOrders: Order[];
  timestamp: string;
}
```

#### Match Notifications
```typescript
socket.on('match-created', (data: MatchNotificationDto) => {
  console.log('Order matched:', data.orderId);
  console.log('Matches:', data.matches);
  if (data.remainingOrder) {
    console.log('Partially filled, remaining:', data.remainingOrder);
  }
});
```

**Data Structure:**
```typescript
{
  orderId: string;
  matches: Array<{
    lendOrderId: string;
    borrowOrderId: string;
    rate: number;
    quantity: string;
    timestamp: string;
  }>;
  remainingOrder?: Order;
  timestamp: string;
}
```

#### Order Status Updates
```typescript
socket.on('order-status-update', (data: OrderStatusUpdateDto) => {
  console.log('Order status:', data.status);
  console.log('Filled quantity:', data.filledQuantity);
});
```

**Data Structure:**
```typescript
{
  orderId: string;
  accountId: string;
  status: 'OPEN' | 'FILLED' | 'CANCELLED' | 'PARTIALLY_FILLED';
  filledQuantity?: string;
  timestamp: string;
}
```

#### Order Errors
```typescript
socket.on('order-error', (data: OrderErrorDto) => {
  console.error('Order error:', data.errorCode);
  console.error('Message:', data.message);
});
```

**Data Structure:**
```typescript
{
  orderId?: string;
  accountId?: string;
  errorCode: 'VALIDATION_ERROR' | 'INVALID_ORDER' | 'ORDER_NOT_FOUND' | 
             'RATE_MISMATCH' | 'INSUFFICIENT_LIQUIDITY' | 'INTERNAL_ERROR' | 
             'NATS_CONNECTION_ERROR' | 'MESSAGE_PARSE_ERROR';
  message: string;
  timestamp: string;
}
```

## Room Management

### Room Naming Convention

| Room Type | Pattern | Example |
|-----------|---------|---------|
| Order Book | `orderbook:{loanToken}:{maturity}` | `orderbook:USDC:1234567890` |
| User Orders | `user:{accountId}` | `user:account-123` |

### Broadcasting Logic

| Event | Broadcast Target |
|-------|-----------------|
| `orderbook-update` | Room: `orderbook:{loanToken}:{maturity}` |
| `match-created` | Global (all clients) |
| `order-status-update` | Room: `user:{accountId}` |
| `order-error` | Room: `user:{accountId}` (if accountId present) |

## Caching

The gateway maintains an in-memory cache of the latest order book snapshot for each token/maturity pair.

**Benefits:**
- New subscribers receive immediate snapshot without waiting for next NATS update
- Reduces load on matching engine
- Improves client UX with instant data

**Cache Key:** `orderbook:{loanToken}:{maturity}`

## Client Usage Example

### TypeScript/JavaScript Client

```typescript
import { io } from 'socket.io-client';

// Connect to WebSocket server
const socket = io('http://localhost:3000', {
  cors: {
    origin: '*'
  }
});

// Connection lifecycle
socket.on('connect', () => {
  console.log('Connected to WebSocket server');
  
  // Subscribe to USDC order book
  socket.emit('subscribe-orderbook', {
    loanToken: 'USDC',
    maturity: 1234567890
  });
  
  // Subscribe to user's orders
  socket.emit('subscribe-user-orders', {
    accountId: 'account-123'
  });
});

// Listen for order book updates
socket.on('orderbook-update', (data) => {
  console.log('Order book updated:', data);
  // Update UI with new order book data
  updateOrderBookUI(data.lendOrders, data.borrowOrders);
});

// Listen for match notifications
socket.on('match-created', (data) => {
  console.log('Match created:', data);
  // Show notification to user
  showMatchNotification(data);
});

// Listen for order status updates
socket.on('order-status-update', (data) => {
  console.log('Order status updated:', data);
  // Update order status in UI
  updateOrderStatus(data.orderId, data.status);
});

// Listen for errors
socket.on('order-error', (data) => {
  console.error('Order error:', data);
  // Show error to user
  showErrorNotification(data.message);
});

// Cleanup on disconnect
socket.on('disconnect', () => {
  console.log('Disconnected from WebSocket server');
});

// Unsubscribe when done
function cleanup() {
  socket.emit('unsubscribe-orderbook', {
    loanToken: 'USDC',
    maturity: 1234567890
  });
  
  socket.emit('unsubscribe-user-orders', {
    accountId: 'account-123'
  });
  
  socket.disconnect();
}
```

### React Hook Example

```typescript
import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';

interface UseOrderBookOptions {
  loanToken: string;
  maturity: number;
  accountId?: string;
}

export function useOrderBook({ loanToken, maturity, accountId }: UseOrderBookOptions) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [orderBook, setOrderBook] = useState<OrderBookSnapshotDto | null>(null);
  const [matches, setMatches] = useState<MatchNotificationDto[]>([]);
  const [errors, setErrors] = useState<OrderErrorDto[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    // Connect to WebSocket
    const newSocket = io('http://localhost:3000');
    
    newSocket.on('connect', () => {
      setConnected(true);
      
      // Subscribe to order book
      newSocket.emit('subscribe-orderbook', { loanToken, maturity });
      
      // Subscribe to user orders if accountId provided
      if (accountId) {
        newSocket.emit('subscribe-user-orders', { accountId });
      }
    });

    newSocket.on('disconnect', () => {
      setConnected(false);
    });

    newSocket.on('orderbook-update', (data: OrderBookSnapshotDto) => {
      setOrderBook(data);
    });

    newSocket.on('match-created', (data: MatchNotificationDto) => {
      setMatches(prev => [...prev, data]);
    });

    newSocket.on('order-error', (data: OrderErrorDto) => {
      setErrors(prev => [...prev, data]);
    });

    setSocket(newSocket);

    // Cleanup
    return () => {
      newSocket.emit('unsubscribe-orderbook', { loanToken, maturity });
      if (accountId) {
        newSocket.emit('unsubscribe-user-orders', { accountId });
      }
      newSocket.disconnect();
    };
  }, [loanToken, maturity, accountId]);

  return {
    socket,
    orderBook,
    matches,
    errors,
    connected
  };
}
```

## Testing

Run the test suite:

```bash
npm test -- websocket.gateway.test.ts
```

### Test Coverage

- ✅ Gateway initialization
- ✅ NATS subscription setup
- ✅ Client connection lifecycle
- ✅ Room subscription/unsubscription
- ✅ Order book snapshot broadcasting
- ✅ Match notification broadcasting
- ✅ Order status update broadcasting
- ✅ Error notification broadcasting
- ✅ Multi-room management
- ✅ Order book caching
- ✅ Error handling

**Total: 24 tests passing**

## Configuration

### Environment Variables

```bash
# NATS connection URL
NATS_URL=nats://localhost:4222

# WebSocket server port (configured in main.ts)
PORT=3000
```

### CORS Configuration

Current CORS settings allow all origins (`*`). For production, restrict to specific domains:

```typescript
@WebSocketGateway({
  cors: {
    origin: ['https://yourdomain.com', 'https://app.yourdomain.com'],
    credentials: true
  },
})
```

## Monitoring

### Logs

The gateway logs the following events:

- Gateway initialization
- Client connections/disconnections
- Room subscriptions/unsubscriptions
- NATS subscription status
- Order book broadcasts
- Error notifications

### Example Log Output

```
[Nest] 12345 - 01/01/2026, 12:00:00 AM   LOG [EventsGateway] WebSocket Gateway initialized
[Nest] 12345 - 01/01/2026, 12:00:00 AM   LOG [EventsGateway] Subscribed to orderbook.snapshot
[Nest] 12345 - 01/01/2026, 12:00:00 AM   LOG [EventsGateway] Subscribed to matches.created
[Nest] 12345 - 01/01/2026, 12:00:00 AM   LOG [EventsGateway] Subscribed to orders.status
[Nest] 12345 - 01/01/2026, 12:00:00 AM   LOG [EventsGateway] Subscribed to orders.error
[Nest] 12345 - 01/01/2026, 12:00:01 AM   LOG [EventsGateway] Client connected: abc123def456
[Nest] 12345 - 01/01/2026, 12:00:01 AM   LOG [EventsGateway] Client abc123def456 joined room orderbook:USDC:1234567890
```

## Performance Considerations

### Caching
- **Memory usage**: Each order book snapshot is cached in memory
- **Cache size**: Grows with number of unique token/maturity pairs
- **Future improvement**: Implement LRU cache or TTL-based eviction

### Broadcasting
- **Match notifications**: Currently broadcast globally (consider filtering)
- **Throttling**: No throttling implemented (consider rate limiting for high-frequency updates)

### Scalability
- **Single instance**: Current implementation runs on single server
- **Future improvement**: Use Redis adapter for multi-instance Socket.IO
- **Horizontal scaling**: Requires shared cache (Redis) for order book snapshots

## Future Enhancements

1. **Authentication**
   - Add JWT token validation in connection handshake
   - Restrict user-specific subscriptions to authenticated users

2. **Throttling/Batching**
   - Implement debouncing for high-frequency order book updates
   - Batch multiple small updates into single broadcast

3. **Redis Integration**
   - Use Redis for distributed caching
   - Enable horizontal scaling with Redis Socket.IO adapter

4. **Metrics**
   - Track connection count
   - Monitor broadcast frequency
   - Measure cache hit rate

5. **Smart Broadcasting**
   - Filter match notifications to relevant rooms
   - Only broadcast to clients who have orders in matched pair

## Troubleshooting

### Client not receiving updates

1. Check if client is connected: `socket.connected`
2. Verify subscription was successful (check response)
3. Ensure NATS connection is active
4. Check server logs for errors

### Cached snapshot not delivered

1. Verify order book snapshot was received from NATS
2. Check room key matches exactly: `orderbook:{token}:{maturity}`
3. Ensure subscription happens after gateway initialization

### NATS connection errors

1. Verify NATS server is running: `nats-server`
2. Check NATS_URL environment variable
3. Ensure matching engine is publishing to correct topics
4. Check NATS server logs

## Related Documentation

- [Matching Engine Architecture](../../../docs/matching-engine/ARCHITECTURE.md)
- [NATS Integration](../../../docs/matching-engine/NATS_INTEGRATION.md)
- [NATS Service Summary](../../../docs/matching-engine/NATS_SERVICE_SUMMARY.md)
