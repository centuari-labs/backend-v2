# CLAUDE.md — Backend API (NestJS)

## Stack

NestJS 11 · TypeORM 0.3 · PostgreSQL 16 · NATS 2 · Socket.io · Privy Auth · Viem · Biome · Jest 30 · pnpm

## Commands

```bash
pnpm run start:dev          # dev server (nest start --watch)
pnpm run build              # compile
pnpm run test               # unit tests
pnpm run test:integration   # integration tests
pnpm run test:e2e           # e2e tests
pnpm run lint               # biome check --apply
pnpm run format             # biome format --write
pnpm run migrate            # run DB migrations
pnpm run seed               # seed database
```

## Architecture

```
src/
├── common/          # Shared decorators, guards, interceptors, filters, validators, utils
├── core/            # Infrastructure: database, nats, privy, viem, websocket
├── auth/            # Privy-based authentication module
├── orders/          # Order management (main business logic)
├── market/          # Market/pool data
├── portfolio/       # User positions & collateral
├── deposit/         # Deposit operations
├── withdraw/        # Withdrawal operations
├── repay/           # Repayment operations
├── faucet/          # Testnet token distribution
├── price/           # Price feeds (CoinGecko)
├── tokens/          # Token/asset management
├── rate-history/    # Historical rate data
├── chain-indexer/   # Blockchain indexing integration
└── __test__/        # Tests mirror src/ structure
```

### Module Pattern

Each feature is a NestJS module with: `module.ts`, `controller.ts`, `service.ts`, and optionally `*.entity.ts`, `*.repository.ts`, `*.dto.ts`. Core infrastructure lives in `core/` and is imported globally.

### Request Flow

```
Request → AuthGuard → Controller → Service → Repository/NATS/Viem → Response Interceptor
```

### Auth Flow

```
AuthGuard → AuthStrategyFactory → PrivyAuthStrategy → sets request.user { userId, walletAddress }
```

## Design Patterns

### Order Creation
- **Unified Method**: Use a single `createOrder()` method that accepts parameters for `side` and `type`.
- **No Per-Variant Methods**: Avoid creating separate methods like `createLendMarketOrder()` or `createBorrowLimitOrder()`. Handle variance via parameters or DTOs.

### DTO Composition
- **Class Inheritance**: Use base class inheritance for shared fields across DTOs.
- **Utility Types**: Leverage NestJS `@nestjs/mapped-types` or `@nestjs/swagger` utilities like `OmitType`, `PickType`, and `IntersectionType` for derived DTOs to ensure type safety and DRY code.

### Repository Pattern
- **Centralized Access**: All database access must go through repository classes.
- **No Raw SQL**: Never write raw SQL strings in services or WebSocket gateways. Use TypeORM QueryBuilder or repository methods.

### Transaction Management
- **Transaction Helper**: Use the `withTransaction(dataSource, manager => { ... })` utility for operations requiring atomicity. Do not manage transactions manually via QueryRunners in services.

## Code Standards

### Naming

| Element | Convention | Example |
|---------|-----------|---------|
| Files | kebab-case with suffix | `create-lend-limit-order.dto.ts`, `order.entity.ts` |
| Classes | PascalCase | `OrdersService`, `AuthGuard` |
| Methods/Properties | camelCase | `getTotalOpenQuantity`, `walletAddress` |
| Constants | SCREAMING_SNAKE_CASE | `SETTLEMENT_FEE_RATE_BPS` |
| Enums | PascalCase members | `OrderSide.Lend`, `OrderType.Market` |
| DB columns | snake_case (via TypeORM) | `filled_quantity`, `created_at` |

### File Suffixes

Always use the appropriate suffix: `.module.ts`, `.controller.ts`, `.service.ts`, `.entity.ts`, `.repository.ts`, `.dto.ts`, `.guard.ts`, `.interceptor.ts`, `.filter.ts`, `.decorator.ts`, `.worker.ts`, `.utils.ts`, `.constants.ts`, `.test.ts`

### Clean Code Rules

1. **One module per domain** — never mix concerns across modules. If a service needs another module's data, import the module and inject the service.
2. **DTOs for all input** — every controller endpoint receives a class-validator DTO. Never pass raw `body` objects to services.
3. **Repository pattern** — All DB access must go through repositories. Never write raw SQL in services or WebSocket gateways.
4. **No business logic in controllers** — controllers only validate input, call service methods, and return results.
5. **Thin services** — services orchestrate logic. Extract complex calculations to `utils/`. Use repositories for DB queries.
6. **Custom decorators over repetition** — use `@Wallet()`, `@CurrentUser()` instead of manual extraction from `request`.
7. **Explicit module exports** — only export what other modules need.
8. **Use NestJS exceptions** — throw specific exceptions (e.g., `BadRequestException`).
9. **Async/await everywhere** — all service methods touching external systems must be async.
10. **No circular dependencies** — use `forwardRef()` only when strictly necessary.
11. **Global Validation** — Validation is handled globally via `ValidationPipe` in `main.ts`. Do not add `@UsePipes(new ValidationPipe())` to controllers.
12. **Plain Object Returns** — Services should return plain JavaScript objects. The global `ResponseInterceptor` handles wrapping them into the standard response format.
13. **WebSocket Memory Safety** — All in-memory caches used in gateways or real-time services must implement eviction policies and maximum size caps to prevent memory leaks.
14. **Config Centralization** — Shared chain, operator, or protocol configuration must live in `ChainConfigService`. Do not repeat config logic or environment lookups in constructors.
15. **Consistent Error Typing** — Always treat errors as untyped. Use `error instanceof Error ? error.message : String(error)` when converting to strings. Never assume `error.message` exists.

### Entity Rules

- Always use `@PrimaryGeneratedColumn("uuid")` for IDs
- Always add `@CreateDateColumn()` and `@UpdateDateColumn()`
- Use `@Index()` on columns used in WHERE clauses
- Use `@Column({ type: "varchar", length: N })` — always specify column type and length
- Define relations explicitly with `@ManyToOne` / `@OneToMany` + `@JoinColumn`

### DTO Rules

- Use `class-validator` decorators for all fields
- Use `class-transformer` for type conversion (`@Transform`, `@Type`)
- Group related validations (e.g., `@IsPositiveNumericString()` custom validator)
- **Inheritance & Utilities**: Use `PartialType()`, `PickType()`, or `OmitType()` for derived DTOs (e.g., `UpdateOrderDto` extending `CreateOrderDto`) to avoid field duplication.

### Testing Rules

- Tests in `src/__test__/` mirror `src/` structure
- Use `Test.createTestingModule()` for DI setup
- Mock external dependencies with `jest.fn()` and typed mocks `jest.Mocked<T>`
- Create factory functions (`createMockOrder()`) for test data — never inline large object literals
- Test both success paths and all error paths
- E2E tests in `test/` directory test full request lifecycle

### Response Format

All responses are wrapped by the global interceptor:

```typescript
// Success (paginated)
{ statusCode: 200, data: [...], meta: { page, limit, total } }

// Success (single)
{ statusCode: 200, data: result }

// Error
{ success: false, message: "...", statusCode: 400, timestamp: "...", path: "/..." }
```

### Inter-Service Communication

- **NATS** (request/reply) for backend ↔ matching engine
- **Socket.io** for real-time frontend updates
- Never call other services via HTTP — use NATS subjects defined in `orders/constants/`

### Formatting

Biome v2.3.4: 4-space indent, 80-char line width, LF line endings. Run `pnpm run lint` before committing.
