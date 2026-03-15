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
3. **Repository pattern** — extend `Repository<Entity>` for custom queries. Use QueryBuilder for dynamic SQL. Never write raw SQL in services.
4. **No business logic in controllers** — controllers only validate input (via DTOs/pipes), call service methods, and return results.
5. **Thin services** — services orchestrate. Extract complex calculations to `utils/`. Extract DB queries to repositories.
6. **Custom decorators over repetition** — use `@Wallet()`, `@CurrentUser()`, `@BearerToken()` instead of extracting from `request` manually.
7. **Explicit module exports** — only export what other modules actually need. Don't export everything by default.
8. **Use NestJS exceptions** — throw `BadRequestException`, `ForbiddenException`, `NotFoundException` etc. The global `AllExceptionsFilter` formats them consistently.
9. **Async/await everywhere** — all service methods that touch DB, NATS, or external APIs must be async and return `Promise<T>`.
10. **No circular dependencies** — if unavoidable, use `forwardRef()` and document why.

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
- Use `PartialType()` / `PickType()` / `OmitType()` for derived DTOs — don't duplicate fields

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
