---
title: feat: Comprehensive Backend Test Suite
type: feat
status: active
date: 2026-02-25
---

# Comprehensive Backend-v2 Test Suite

## Context

The backend-v2 has 23 existing test files covering orders.service, websocket.gateway, auth guards, DTOs, price, portfolio, etc. However, several critical modules lack tests: **OrdersWorker** (random order creation/fill pipeline), **OrdersController** (REST endpoints), and **OrderRepository** (custom repository methods). Additionally, there are no integration tests with a real database or E2E tests for REST + WebSocket flows. The user requested all test types with integration tests in a separate folder accessible via `pnpm test:integration`.

## Files to Create/Modify

### Shared Test Utilities (2 new files)
- `src/__test__/helpers/mock-factories.ts` — Reusable factory functions (`createMockOrder`, `createMockAccount`, `createMockMarket`, `createMockToken`)
- `src/__test__/helpers/mock-services.ts` — Pre-configured mock service creators (`createMockOrderRepository`, `createMockNatsService`, `createMockEventsGateway`, etc.)

### Unit Tests (3 new files)
- `src/__test__/orders/orders.worker.test.ts` — ~18 tests
- `src/__test__/orders/orders.controller.test.ts` — ~12 tests
- `src/__test__/orders/orders.repository.test.ts` — ~14 tests

### Integration Test Config + Tests (4 new files)
- `jest-integration.config.json` — Separate Jest config for integration tests
- `src/__test__/integration/orders-flow.integration.test.ts` — ~10 tests (order create → fill → positions via real DB)
- `src/__test__/integration/websocket-recent-trades.integration.test.ts` — ~9 tests (Socket.IO client connecting to real gateway)
- `src/__test__/integration/auth-flow.integration.test.ts` — ~8 tests (auth guard with real Privy token validation)

### E2E Config Update + Tests (2 new files + 1 update)
- `test/jest-e2e.json` — Update with `moduleNameMapper` and `transformIgnorePatterns`
- `test/orders.e2e-spec.ts` — ~14 tests (HTTP endpoints via supertest)
- `test/websocket.e2e-spec.ts` — ~10 tests (Socket.IO E2E via real NestJS server)

### Config Changes
- `package.json` — Add `"test:integration"` script

## Implementation Plan

### Step 1: Shared Helpers

**`src/__test__/helpers/mock-factories.ts`**
- `createMockOrder(overrides?)` — Returns a full `Order` entity with sensible defaults
- `createMockAccount(overrides?)` — Returns `Account` entity
- `createMockMarket(overrides?)` — Returns `Market` entity with maturity date
- `createMockToken(overrides?)` — Returns `Token` entity with tokenAddress

**`src/__test__/helpers/mock-services.ts`**
- `createMockOrderRepository()` — All methods as `jest.fn()`, matching `OrderRepository` interface
- `createMockNatsService()` — `publish`, `subscribe`, `isConnected` mocks
- `createMockEventsGateway()` — `handleMatchCreated` mock
- `createMockDataSource()` — `transaction`, `createQueryBuilder` mocks
- `createMockMarketRepository()` / `createMockTokenRepository()` — `find`, `findOne` mocks

### Step 2: Unit Tests

**`orders.worker.test.ts`** (~18 tests)
```
describe('OrdersWorker')
  describe('onModuleInit')
    - loads cache when enabled
    - skips when disabled
  describe('refreshAssetMarketCache')
    - populates cache from markets + tokens
    - handles empty markets gracefully
    - logs error on failure
  describe('createRandomOrder')
    - skips when cache empty
    - skips when open orders >= MAX_OPEN_ORDERS
    - creates lend limit order
    - creates borrow limit order
    - handles creation error
  describe('partiallyFillRandomOrder')
    - partially fills an open order
    - skips when no open orders
    - skips when remaining <= 0
    - does not overfill (nextFilled >= quantity → skip)
  describe('fillRandomOrder')
    - fills partially filled order with counterparty
    - fills open order when no partially filled
    - creates match + positions in transaction
    - broadcasts recent trade via gateway
    - skips when no orders have order_markets
```

**`orders.controller.test.ts`** (~12 tests)
```
describe('OrdersController')
  describe('POST /orders/lend/market')
    - delegates to ordersService.createLendMarketOrder
    - passes wallet and userId
  describe('POST /orders/lend/limit')
    - delegates to ordersService.createLendLimitOrder
  describe('POST /orders/borrow/market')
    - delegates to ordersService.createBorrowMarketOrder
  describe('POST /orders/borrow/limit')
    - delegates to ordersService.createBorrowLimitOrder
  describe('PATCH /orders/:id/cancel')
    - delegates to ordersService.cancelOrder
    - passes wallet address
  (edge cases)
    - returns result from service
    - handles service exceptions
```

**`orders.repository.test.ts`** (~14 tests)
```
describe('OrderRepository')
  describe('saveOrderWithMarkets')
    - saves order + order_market rows in transaction
    - creates multiple order_market rows for multiple marketIds
    - rolls back on failure
  describe('getOrCreateAccount')
    - returns existing account
    - creates new account when not found
    - sets privyUserId on new account
  describe('getBestRates')
    - returns highest bid + lowest ask per asset
    - handles no open orders (empty map)
    - ignores non-open orders
  describe('getOpenOrders')
    - returns open orders for assetId
    - returns all open orders when no assetId
  describe('findAccountByWallet')
    - finds account case-insensitively
    - returns null when not found
```

### Step 3: Integration Test Infrastructure

**`jest-integration.config.json`**
```json
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": ".",
  "roots": ["<rootDir>/src/__test__/integration"],
  "testRegex": ".*\\.integration\\.test\\.ts$",
  "transform": { "^.+\\.(t|j)s$": "ts-jest" },
  "transformIgnorePatterns": ["node_modules/(?!jose)"],
  "moduleNameMapper": {
    "^@/(.*)$": "<rootDir>/src/$1",
    "^src/(.*)$": "<rootDir>/src/$1"
  },
  "testEnvironment": "node",
  "testTimeout": 30000
}
```

**`package.json`** — Add script:
```json
"test:integration": "jest --config ./jest-integration.config.json"
```

### Step 4: Integration Tests

**`orders-flow.integration.test.ts`** (~10 tests)
- Uses `Test.createTestingModule` with full OrdersModule + in-memory/mocked DB
- Tests: create lend order → verify DB state → partially fill → fill → verify positions created
- Verifies the full order lifecycle with mocked DataSource transaction

**`websocket-recent-trades.integration.test.ts`** (~9 tests)
- Spins up NestJS app with Socket.IO
- Connects `socket.io-client` (devDependency needed)
- Tests: subscribe to recent-trades room → receive trade on handleMatchCreated → snapshot on reconnect → unsubscribe stops events
- Tests orderbook subscription + aggregation flow

**`auth-flow.integration.test.ts`** (~8 tests)
- Tests AuthGuard with DevAuthStrategy in development mode
- Tests missing/invalid `x-wallet-address` header handling
- Tests `@Wallet()` and `@CurrentUser()` decorator extraction
- Mocks PrivyAuthStrategy for production mode validation

### Step 5: E2E Config + Tests

**`test/jest-e2e.json`** — Add missing settings:
```json
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": ".",
  "testEnvironment": "node",
  "testRegex": ".e2e-spec.ts$",
  "transform": { "^.+\\.(t|j)s$": "ts-jest" },
  "transformIgnorePatterns": ["node_modules/(?!jose)"],
  "moduleNameMapper": {
    "^@/(.*)$": "<rootDir>/src/$1",
    "^src/(.*)$": "<rootDir>/src/$1"
  }
}
```

**`test/orders.e2e-spec.ts`** (~14 tests)
- Full NestJS app via `createNestApplication()`
- Uses `supertest` for HTTP requests
- Auth via `x-wallet-address` + `x-privy-user-id` headers (DevAuthStrategy)
- Tests all 5 endpoints: 4x create order + 1x cancel
- Validates response shape matches `OrderResponse` DTO
- Tests validation errors (missing fields, invalid UUIDs)
- Tests auth rejection (no wallet header)

**`test/websocket.e2e-spec.ts`** (~10 tests)
- Boots NestJS app, connects `socket.io-client`
- Tests: subscribe-orderbook → receive orderbook-update
- Tests: subscribe-recent-trades → receive snapshot → receive live trades
- Tests: subscribe open-positions / active-positions rooms
- Tests: unsubscribe leaves room correctly
- DevDependency: `socket.io-client`

### Step 6: Install Dependencies + Verify

```bash
pnpm add -D socket.io-client
pnpm test                                      # All unit tests pass
pnpm test:integration                          # Integration tests
pnpm test:integration -- --testPathPattern="orders-flow"  # Single integration
pnpm test:e2e                                  # E2E tests
```

## Key Patterns to Follow (from existing tests)

- `jest.Mocked<T>` for typed mocks
- `Test.createTestingModule()` for NestJS DI
- `createMockOrder()` factory functions
- `describe()` blocks grouped by method
- `beforeEach()` resets all mocks
- Relative imports from `../../module/file` in `__test__/` directory
- `transformIgnorePatterns: ["node_modules/(?!jose)"]` in all jest configs

## Verification

1. `pnpm test` — All existing 23 test files + 3 new unit test files pass
2. `pnpm test:integration` — 3 integration test files pass
3. `pnpm test:integration -- --testPathPattern="orders-flow"` — Filters correctly
4. `pnpm test:e2e` — 2 E2E test files pass
5. `pnpm test:cov` — Coverage improved for orders module
