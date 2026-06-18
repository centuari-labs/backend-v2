# Testing Guide

This document outlines the testing strategy, environment setup, and patterns for the `backend-v2` project.

## Environment Setup

Testing requires a clean environment. Ensure you have the necessary infrastructure running.

### Infrastructure
- **PostgreSQL**: Used for persistence.
- **NATS**: Used for message-driven architecture.

You can start these using Docker (if available) or ensuring local instances are active.

### Test Environment Variables
Copy `.env` to `.env.test` and adjust the variables for a test database.
```bash
cp .env .env.test
```

## Testing Types

### Unit Testing
Unit tests focus on individual components (Services, Controllers, Guards) in isolation.

- **Framework**: Jest with `@nestjs/testing`.
- **Location**: `src/**/*.spec.ts`.
- **Command**: `pnpm run test`

#### Pattern: Service Mocking
When testing controllers or services, always mock dependencies to avoid side effects.

```typescript
const module: TestingModule = await Test.createTestingModule({
  providers: [
    OrdersService,
    {
      provide: getRepositoryToken(Order),
      useValue: mockOrderRepository,
    },
    {
      provide: 'NATS_SERVICE',
      useValue: mockNatsClient,
    },
  ],
}).compile();
```

### E2E Testing
End-to-End tests validate the entire application flow, including database and messaging integration.

- **Location**: `test/**/*.e2e-spec.ts`.
- **Command**: `pnpm run test:e2e`

#### Execution Flow
1. Initialize the Nest application using `Test.createTestingModule`.
2. Use `supertest` to make HTTP requests.
3. Assert results against the expected state.

## Mocking Strategies

### Authentication (Privy)
Mock the `PrivyService` or the `AuthGuard` to simulate authenticated users.

```typescript
// Example: Mocking AuthGuard
.overrideGuard(AuthGuard)
.useValue({ canActivate: () => true })
```

### NATS Messaging
Use a mock NATS client to verify that subjects are published without needing a live NATS server for unit tests. Use a live NATS container/instance for E2E tests if integration validation is required.

## Continuous Integration
Tests are automatically executed on every push. Coverage reports are generated in the `coverage/` directory.

- **Command**: `pnpm run test:cov`

## Security and Performance
- Ensure tests cover boundary conditions for interest rates (0.01% - 100%).
- For performance-critical logic, use `console.time` or dedicated benchmarks.

## Manual Testing with cURL

Below are example cURL commands for hitting the API endpoints locally.

**Base URL**: `http://localhost:3000` (default)
**Headers**:
- Content-Type: `application/json`
- Authorization: `Bearer <YOUR_PRIVY_TOKEN>` (Required for protected routes)

### Public Endpoints

**Health Check**
```bash
curl http://localhost:3000/
```

**Validate Wallet**
```bash
curl -X POST http://localhost:3000/auth/validate \
  -H "Content-Type: application/json" \
  -d '{"wallet_address": "0xYourWalletAddress"}'
```

### Protected Endpoints (Requires Token)

**Create Lend Market Order**
```bash
curl -X POST http://localhost:3000/orders/lend/market \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <YOUR_TOKEN>" \
  -d '{
    "assetId": "b66a2641-3339-4a48-805c-6da248f33dee",
    "amount": "100"
  }'
```

**Create Lend Limit Order**
```bash
curl -X POST http://localhost:3000/orders/lend/limit \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "assetId": "b66a2641-3339-4a48-805c-6da248f33dee",
    "amount": "100",
    "rate": 550,
    "maturities": [1720000000]
  }'
```

**Create Borrow Market Order**
```bash
curl -X POST http://localhost:3000/orders/borrow/market \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <YOUR_TOKEN>" \
  -d '{
    "assetId": "b66a2641-3339-4a48-805c-6da248f33dee",
    "amount": "10"
  }'
```

**Create Borrow Limit Order**
```bash
curl -X POST http://localhost:3000/orders/borrow/limit \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <YOUR_TOKEN>" \
  -d '{
    "assetId": "b66a2641-3339-4a48-805c-6da248f33dee",
    "amount": "10",
    "interestRate": 2.5
  }'
```

**Cancel Order**
```bash
curl -X PATCH http://localhost:3000/orders/<ORDER_UUID>/cancel \
  -H "Authorization: Bearer <YOUR_TOKEN>"
```
