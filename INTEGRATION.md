# Portfolio Module Integration Guide

This document outlines the authentication setup, testing procedures, and environment configuration for the Portfolio Module.

## 1. Authentication Modes

The Portfolio module behavior is controlled by the `NODE_ENV` environment variable.

### Development Mode
**Enabled when:** `NODE_ENV=development` inside `.env`

- **Purpose:** Testing without valid Privy tokens and using Mock Prices.
- **Mechanism:** Accepts `Bearer DEV_TOKEN_<WALLET_ADDRESS>`.
- **Validation:** 
  - Checks for `DEV_TOKEN_` prefix.
  - Extracts wallet address directly from the token string.
- **Example Header:**
  ```
  Authorization: Bearer DEV_TOKEN_0x71C7656EC7ab88b098defB751B7401B5f6d8976F
  ```
- **Prices:** Uses internal mock prices for test tokens (BTC, ETH, etc.).

### Production Mode
**Enabled when:** `NODE_ENV=production` (or any other value).

- **Purpose:** Real user authentication and real CoinGecko prices.
- **Mechanism:** Validates JWT against Privy public key.
- **Validation:**
  - Verify token signature with Privy.
  - Fetches user details from Privy to resolve `walletAddress`.
- **Example Header:**
  ```
  Authorization: Bearer <REAL_PRIVY_JWT_TOKEN>
  ```
- **Prices:** Fetches live prices from CoinGecko API.

## 2. Database migrations and seeding configuration

### Automatic migrations on app start

Migrations can be automatically triggered when the backend starts by using the `MIGRATIONS_ON_START` environment variable.

- **Enabled when:** `MIGRATIONS_ON_START=true`
- **Behavior:** On bootstrap, the app will run all pending migrations via the `runMigrations` script before any seeding or HTTP startup.
- **Idempotency:** Migrations are tracked in the `migrations_log` table, so each migration file is applied only once.

Example:

```env
DATABASE_URL=postgres://...
NODE_ENV=development
MIGRATIONS_ON_START=true
```

You can still run migrations manually (independent of `MIGRATIONS_ON_START`):

```bash
pnpm migrate
# or
pnpm db up
```

### Automatic seeding on app start

Seeding can be automatically triggered when the backend starts by using the `SEED_ON_START` environment variable.

- **Enabled when:** `SEED_ON_START=true`
- **Behavior:** On bootstrap, after running migrations, the app will execute all seed SQL files under `src/core/database/seeds` via the `runSeeds` script.
- **Idempotency:** Executed seeds are recorded in a `seeds_log` table, so the same seed file will not be applied twice. Re-running the app or the seed command will **skip already-applied seeds**.

Example:

```env
DATABASE_URL=postgres://...
NODE_ENV=development
MIGRATIONS_ON_START=true
SEED_ON_START=true
```

Then start the app as usual (for example):

```bash
pnpm start:dev
```

### Manual seeding

You can still run seeds manually; they are also idempotent because of `seeds_log`:

- Run all seeds:

```bash
pnpm seed
```

- Run all seeds via the DB CLI:

```bash
pnpm db seed:run
```

- Run a specific seed (match by full or partial filename):

```bash
pnpm db seed:run portfolio_extended_seed
```

## 3. Testing with Postman

### Prerequisites
1. Ensure the server is running (`npm run start:dev` typically sets `NODE_ENV=development` by default in NestJS, potentially overriding `.env` if not careful. Check your `package.json`).
2. Verify database seeds are applied (`npm run seed` or manual SQL execution).

### Scenario A: Development Testing

1. **Set Environment:**
   Ensure `.env` contains:
   ```env
   NODE_ENV=development
   ```
   Or run the server with `NODE_ENV=development npm run start:dev`.

2. **Request - Get My Portfolio:**
   - **Method:** GET
   - **URL:** `http://localhost:3000/portfolio/my-portfolio`
   - **Headers:**
     - Key: `Authorization`
     - Value: `Bearer DEV_TOKEN_0x71C7656EC7ab88b098defB751B7401B5f6d8976F`

3. **Expected Response:**
   ```json
   {
       "totalDeposit": "1000.00", // (or calculated value based on mocks)
       "netAPY": 5.5,
       "allTimeReturn": 0
   }
   ```

### Scenario B: Production Testing

1. **Set Environment:**
   Ensure `.env` contains:
   ```env
   NODE_ENV=production
   ```
   Restart server.

2. **Obtain Token:**
   Login to your frontend application connected to Privy and copy the `accessToken`.

3. **Request:**
   - **Method:** GET
   - **URL:** `http://localhost:3000/portfolio/my-portfolio`
   - **Headers:**
     - Key: `Authorization`
     - Value: `Bearer <YOUR_REAL_TOKEN>`
