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

## 2. Testing with Postman

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
