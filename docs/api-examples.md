## Auth

### POST `/auth/validate`

- **Description**: Validate a user’s wallet address and return a paired deposit wallet.
- **Request body** (JSON):

```json
{
  "wallet_address": "0x1234567890abcdef1234567890abcdef12345678"
}
```

- **Response 200** (JSON):

```json
{
  "id": 1,
  "wallet_address": "0x1234567890abcdef1234567890abcdef12345678",
  "paired_wallet_address": "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
  "paired_wallet_primary_key": "some-primary-key"
}
```

---

## Orders

All orders require:

- **Headers**:
  - `Authorization: Bearer {{authToken}}`
  - `Content-Type: application/json` (for POSTs)

### POST `/orders/lend/limit`

- **Description**: Create a lend limit order.
- **Request body** (JSON):

```json
{
  "assetId": "b66a2641-3339-4a48-805c-6da248f33dee",
  "amount": "100",
  "marketIds": ["00000000-0000-0000-0000-000000000001"],
  "rate": 550,
  "autoRollover": false
}
```

- **Response 201** (JSON):

```json
{
  "statusCode": 201,
  "data": {
    "orderId": "11111111-2222-3333-4444-555555555555",
    "walletAddress": "0x1234567890abcdef1234567890abcdef12345678",
    "assetId": "b66a2641-3339-4a48-805c-6da248f33dee",
    "markets": [
      {
        "marketId": "00000000-0000-0000-0000-000000000001",
        "maturity": 1737052800
      }
    ],
    "timestamp": 1736966400,
    "side": "LEND",
    "type": "LIMIT",
    "status": "OPEN",
    "originalAmount": "100",
    "settlementFeeAmount": "0.5",
    "autoRollover": false,
    "rate": 5,
    "createdAt": "2025-01-15T10:00:00.000Z",
    "updatedAt": "2025-01-15T10:00:00.000Z"
  }
}
```

### POST `/orders/lend/market`

- **Description**: Create a lend market order.
- **Request body** (JSON):

```json
{
  "assetId": "b66a2641-3339-4a48-805c-6da248f33dee",
  "amount": "100",
  "marketIds": ["00000000-0000-0000-0000-000000000001"],
  "autoRollover": false
}
```

- **Response 201** (JSON):

```json
{
  "statusCode": 201,
  "data": {
    "orderId": "22222222-3333-4444-5555-666666666666",
    "walletAddress": "0x1234567890abcdef1234567890abcdef12345678",
    "assetId": "b66a2641-3339-4a48-805c-6da248f33dee",
    "markets": [
      {
        "marketId": "00000000-0000-0000-0000-000000000001",
        "maturity": 1737052800
      }
    ],
    "timestamp": 1736966400,
    "side": "LEND",
    "type": "MARKET",
    "status": "OPEN",
    "originalAmount": "100",
    "settlementFeeAmount": "0.5",
    "autoRollover": false,
    "rate": 4.5,
    "createdAt": "2025-01-15T10:05:00.000Z",
    "updatedAt": "2025-01-15T10:05:00.000Z"
  }
}
```

### POST `/orders/borrow/limit`

- **Description**: Create a borrow limit order.
- **Request body** (JSON):

```json
{
  "assetId": "b66a2641-3339-4a48-805c-6da248f33dee",
  "amount": "10",
  "marketIds": ["00000000-0000-0000-0000-000000000001"],
  "rate": 250,
  "autoRollover": false
}
```

- **Response 201** (JSON):

```json
{
  "statusCode": 201,
  "data": {
    "orderId": "33333333-4444-5555-6666-777777777777",
    "walletAddress": "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
    "assetId": "b66a2641-3339-4a48-805c-6da248f33dee",
    "markets": [
      {
        "marketId": "00000000-0000-0000-0000-000000000001",
        "maturity": 1737052800
      }
    ],
    "timestamp": 1736966400,
    "side": "BORROW",
    "type": "LIMIT",
    "status": "OPEN",
    "originalAmount": "10",
    "settlementFeeAmount": "0.1",
    "autoRollover": false,
    "rate": 2.5,
    "createdAt": "2025-01-15T10:10:00.000Z",
    "updatedAt": "2025-01-15T10:10:00.000Z"
  }
}
```

### POST `/orders/borrow/market`

- **Description**: Create a borrow market order.
- **Request body** (JSON):

```json
{
  "assetId": "b66a2641-3339-4a48-805c-6da248f33dee",
  "amount": "10",
  "marketIds": ["00000000-0000-0000-0000-000000000001"],
  "autoRollover": false
}
```

- **Response 201** (JSON):

```json
{
  "statusCode": 201,
  "data": {
    "orderId": "44444444-5555-6666-7777-888888888888",
    "walletAddress": "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
    "assetId": "b66a2641-3339-4a48-805c-6da248f33dee",
    "markets": [
      {
        "marketId": "00000000-0000-0000-0000-000000000001",
        "maturity": 1737052800
      }
    ],
    "timestamp": 1736966400,
    "side": "BORROW",
    "type": "MARKET",
    "status": "OPEN",
    "originalAmount": "10",
    "settlementFeeAmount": "0.1",
    "autoRollover": false,
    "rate": 2.0,
    "createdAt": "2025-01-15T10:15:00.000Z",
    "updatedAt": "2025-01-15T10:15:00.000Z"
  }
}
```

### PATCH `/orders/{orderId}/cancel`

- **Description**: Cancel an existing order.
- **Path params**:
  - `orderId` – order UUID.

- **Response 200** (JSON):

```json
{
  "statusCode": 200,
  "data": {
    "orderId": "11111111-2222-3333-4444-555555555555",
    "walletAddress": "0x1234567890abcdef1234567890abcdef12345678",
    "assetId": "b66a2641-3339-4a48-805c-6da248f33dee",
    "markets": [
      {
        "marketId": "00000000-0000-0000-0000-000000000001",
        "maturity": 1737052800
      }
    ],
    "timestamp": 1736966400,
    "side": "LEND",
    "type": "LIMIT",
    "status": "CANCELLED",
    "originalAmount": "100",
    "settlementFeeAmount": "0.5",
    "autoRollover": false,
    "rate": 5,
    "createdAt": "2025-01-15T10:00:00.000Z",
    "updatedAt": "2025-01-15T10:20:00.000Z"
  }
}
```

---

## Portfolio

All endpoints require:

- **Headers**:
  - `Authorization: Bearer {{authToken}}`

### GET `/portfolio/my-portfolio`

- **Description**: Summary of user’s portfolio.
- **Response 200** (JSON):

```json
{
  "totalDeposit": 12500.5,
  "allTimeReturn": 320.75,
  "netAPY": 4.2
}
```

### GET `/portfolio/my-assets`

- **Description**: List of assets in the user’s portfolio.
- **Query params**:
  - `page` (optional, default 1)
  - `limit` (optional, default 10)

- **Response 200** (JSON):

```json
{
  "data": [
    {
      "symbol": "USDC",
      "name": "USD Coin",
      "walletBalance": 1500,
      "amountInUsd": 1500,
      "isCollateral": true
    },
    {
      "symbol": "ETH",
      "name": "Ethereum",
      "walletBalance": 1.2,
      "amountInUsd": 3120,
      "isCollateral": false
    }
  ],
  "page": 1,
  "limit": 10,
  "totalData": 2,
  "totalPages": 1
}
```

### GET `/portfolio/lend-borrow-assets`

- **Description**: Counts of supplied and borrowed assets plus health factor.
- **Response 200** (JSON):

```json
{
  "suppliedAssets": 3,
  "borrowedAssets": 1,
  "healthFactor": 1.8
}
```

### GET `/portfolio/my-position`

- **Description**: Paged list of positions for the user.
- **Query params**:
  - `page` (optional, default 1)
  - `limit` (optional, default 10)
  - `type` (optional, `"LEND"` or `"BORROW"`)

- **Response 200** (JSON):

```json
{
  "data": [
    {
      "symbol": "USDC",
      "name": "USD Coin",
      "walletBalance": 1000,
      "amountInUsd": 1000,
      "isCollateral": true
    },
    {
      "symbol": "ETH",
      "name": "Ethereum",
      "walletBalance": 2.5,
      "amountInUsd": 6500,
      "isCollateral": false
    }
  ],
  "page": 1,
  "limit": 10,
  "totalData": 2,
  "totalPages": 1
}
```

### PUT `/portfolio/is-collateral`

- **Description**: Mark one or more assets as collateral or non-collateral.
- **Request body** (JSON):

```json
{
  "assetIds": [
    "497f6eca-6276-4993-bfeb-53cbbbba6f08",
    "550e8400-e29b-41d4-a716-446655440000"
  ],
  "isCollateral": true
}
```

- **Response 204**: No content.

---

## Market

### GET `/market`

- **Description**: Get current market snapshot and per-asset rates.
- **Response 200** (JSON):

```json
{
  "total_deposit": "1000000.00",
  "active_loans": "250000.00",
  "markets": [
    {
      "asset": {
        "id": "b66a2641-3339-4a48-805c-6da248f33dee",
        "name": "USD Coin",
        "symbol": "USDC",
        "decimals": 6
      },
      "borrow_rate": 5.2,
      "lend_rate": 4.1,
      "collateral_factor": 75
    },
    {
      "asset": {
        "id": "00000000-0000-0000-0000-000000000002",
        "name": "Ethereum",
        "symbol": "ETH",
        "decimals": 18
      },
      "borrow_rate": 7.5,
      "lend_rate": 5.8,
      "collateral_factor": 70
    }
  ]
}
```

## Deposit / Token Catalog

### GET `/deposit/tokens`

- **Description**: Canonical token catalog for the frontend. The FE
  caches this response in `localStorage` for 6 hours (see
  `centuari-revamp/frontend-revamp/src/lib/token-cache.ts`) and uses
  it as the single source of truth for token metadata — symbol, name,
  image URL, decimals, address, and chain id. Other endpoints
  (`/portfolio/*`, `/market/*`, etc.) reference tokens by `id` /
  `symbol` and the FE joins back to this catalog on the client.
- **Authentication**: Public. No `Authorization` required.
- **Stability contract** (enforced by
  `src/__test__/integration/deposit-tokens-contract.integration.test.ts`):
  - Response shape matches the FE-side `DepositToken` schema.
  - Tokens listed in `DEPOSIT_TOKEN_PRIORITY` (`USDC`, `USDT`, `IDRX`,
    `XSGD`) appear first and in declared order; remaining tokens are
    sorted alphabetically by symbol.
  - Two consecutive requests return identical bodies.

- **Response 200** (JSON):

```json
{
  "statusCode": 200,
  "data": [
    {
      "id": "c9b79b46-b11d-40e4-9b7d-9f46b8d757b9",
      "symbol": "USDC",
      "name": "USD Coin",
      "tokenAddress": "0x26970F990252306AFa328B2c91225605c0862498",
      "decimals": 6,
      "imageUrl": "/tokens/usdc-icon.webp",
      "chainId": 421614
    }
  ]
}
```

