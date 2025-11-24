# Testing the /validate Endpoint

## Endpoint
`POST /auth/validate`

## Request Body
```json
{
  "wallet_address": "0x742d35Cc6634C0532925a3b844Bc454e4438f44e"
}
```

## Example using curl
```bash
curl -X POST http://localhost:3000/auth/validate \
  -H "Content-Type: application/json" \
  -d '{"wallet_address": "0x742d35Cc6634C0532925a3b844Bc454e4438f44e"}'
```

## Expected Response
```json
{
  "id": 1,
  "wallet_address": "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
  "paired_wallet_address": "0x...",
  "paired_wallet_primary_key": "0x..."
}
```

## Error Response (Invalid Address)
```json
{
  "statusCode": 400,
  "message": "Invalid wallet address format",
  "error": "Bad Request"
}
```
