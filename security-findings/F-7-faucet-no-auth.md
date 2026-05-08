# F-7: `/faucet/request-tokens` has no auth — drains operator

**Severity**: 🔴 Critical
**OWASP**: A01 Broken Access Control, A04 Insecure Design
**CWE**: CWE-862 (Missing Authorization), CWE-770 (Unbounded Resource Consumption)

## Summary

The `POST /faucet/request-tokens` endpoint has no guard at all. Anyone can mint testnet tokens to an arbitrary address. Each request burns ETH from the `OPERATOR_PRIVATE_KEY` wallet for gas and sends tokens from the faucet contract.

## Evidence

`src/faucet/faucet.controller.ts:15-21`:
```typescript
@Post("request-tokens")
async requestTokens(
    @Body() dto: RequestTokenDto,
): Promise<FaucetResponseDto> {
    return this.faucetService.requestTokens(
        dto.chainId,
        dto.recipientAddress,
        dto.token,
    );
}
```

❌ No `@UseGuards(...)`.

### Active exploit confirmed

```bash
$ curl -s -X POST http://localhost:8080/faucet/request-tokens \
    -H "Content-Type: application/json" \
    -d '{"chainId":421614,"recipientAddress":"0x1111111111111111111111111111111111111111","token":"all-assets"}'

{
  "statusCode": 201,
  "data": {
    "chainId": 421614,
    "recipientAddress": "0x1111111111111111111111111111111111111111",
    "transactionHash": "0x8bd5b48307a520f3152a39e5e6741cbb57a95ead4e4e3960502a3d3197f44fac",
    "blockNumber": "266513378",
    "status": "success",
    "results": [
      { "tokenAddress": "0x26970F...", "amount": "5000000000" },
      { "tokenAddress": "0xe1e9f8...", "amount": "5000000000" },
      ...
    ]
  }
}
```

Real on-chain transaction. Operator key burned ETH for gas.

## Impact

- **F-7.1 — Operator gas drain**: 1 request = 1 on-chain tx ≈ 0.0001–0.001 ETH gas. A loop of 1,000 requests can drain the operator wallet.
- **F-7.2 — Token spam**: testnet floods. An attacker can mint to thousands of addresses for Sybil setup.
- **F-7.3 — Mainnet risk**: if this code is forked or upgraded for a mainnet faucet, it becomes a money tap.
- **F-7.4 — Combined with F-2 (no rate limit)**: there is no throttle, so a single IP can run an unbounded loop.

### Estimated loss

Assume 1 request = 0.0005 ETH gas, attacker spams 100 req/sec for 1 hour:
- 360,000 requests
- 180 ETH burned from operator
- On testnet ETH is free, so no $$$ loss, but the operator wallet ends up empty → faucet down for legitimate users → service degradation.

## Reproduction

See "Active exploit confirmed" above. Or loop:

```bash
for i in $(seq 1 100); do
  curl -s -X POST http://localhost:8080/faucet/request-tokens \
    -H "Content-Type: application/json" \
    -d '{"chainId":421614,"recipientAddress":"0xATTACKER...","token":"all-assets"}' &
done
wait
```

## Recommended Solution

### 1. Add authentication

`src/faucet/faucet.controller.ts`:

```diff
+ import { UseGuards } from "@nestjs/common";
+ import { Wallet } from "../common/decorators/wallet.decorator";
+ import { AuthGuard } from "../common/guards/auth.guard";

  @Controller("faucet")
  export class FaucetController {
      constructor(private readonly faucetService: FaucetService) {}

      @Post("request-tokens")
+     @UseGuards(AuthGuard)
      async requestTokens(
          @Body() dto: RequestTokenDto,
+         @Wallet() walletAddress: string,
      ): Promise<FaucetResponseDto> {
+         // Force recipient = authenticated wallet
+         if (dto.recipientAddress.toLowerCase() !== walletAddress.toLowerCase()) {
+             throw new ForbiddenException("Faucet recipient must be your own wallet");
+         }
          return this.faucetService.requestTokens(
              dto.chainId,
-             dto.recipientAddress,
+             walletAddress,
              dto.token,
          );
      }
  }
```

### 2. Per-wallet daily quota (in service)

`src/faucet/faucet.service.ts`:

```typescript
private async checkQuota(walletAddress: string): Promise<void> {
    const last24h = await this.faucetRequestRepo.count({
        where: {
            walletAddress: walletAddress.toLowerCase(),
            createdAt: MoreThan(new Date(Date.now() - 24 * 60 * 60 * 1000)),
        },
    });

    const DAILY_LIMIT = 1;
    if (last24h >= DAILY_LIMIT) {
        throw new TooManyRequestsException(
            `Faucet limit ${DAILY_LIMIT}/day exceeded for ${walletAddress}`
        );
    }
}

async requestTokens(chainId, recipient, token) {
    await this.checkQuota(recipient);
    // ... existing logic
    await this.faucetRequestRepo.save({
        walletAddress: recipient.toLowerCase(),
        chainId,
        token,
        createdAt: new Date(),
    });
}
```

Add migration:

```sql
CREATE TABLE faucet_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_address TEXT NOT NULL,
    chain_id INTEGER NOT NULL,
    token TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_faucet_requests_wallet_created ON faucet_requests (wallet_address, created_at DESC);
```

### 3. Add IP-based rate limit (defense in depth)

```typescript
@Throttle({ default: { limit: 3, ttl: 60000 } })  // 3/min/IP
@UseGuards(IpThrottlerGuard, AuthGuard)
@Post("request-tokens")
```

### 4. Captcha for pre-auth (optional)

If the faucet is intentionally exposed without an account, add a captcha (hCaptcha / Cloudflare Turnstile):

```typescript
@Post("request-tokens")
async requestTokens(@Body() dto: FaucetDtoWithCaptcha) {
    await this.captchaService.verify(dto.captchaToken);
    // ...
}
```

### 5. Audit log

Log every faucet request with IP, wallet, and timestamp for forensic review:

```typescript
this.logger.warn(
    `FAUCET_REQUEST wallet=${walletAddress} ip=${ip} chain=${chainId} token=${token}`
);
```

## Verification

```bash
# After fix:
curl -s -X POST http://localhost:8080/faucet/request-tokens \
  -H "Content-Type: application/json" \
  -d '{"chainId":421614,"recipientAddress":"0x...","token":"all-assets"}'
# Expected: 401 Unauthorized

curl -s -X POST http://localhost:8080/faucet/request-tokens \
  -H "Authorization: Bearer DEV_TOKEN_0xATTACKER..." \
  -H "Content-Type: application/json" \
  -d '{"chainId":421614,"recipientAddress":"0xVICTIM...","token":"all-assets"}'
# Expected: 403 Forbidden (recipient mismatch)

# Second request from the same wallet within 24h:
curl ... -H "Authorization: Bearer DEV_TOKEN_0xATTACKER..." -d '{"recipientAddress":"0xATTACKER..."...}'
curl ... -H "Authorization: Bearer DEV_TOKEN_0xATTACKER..." -d '{"recipientAddress":"0xATTACKER..."...}'
# Expected: 1st = 201, 2nd = 429 Too Many Requests
```

## References

- [OWASP A01:2021 — Broken Access Control](https://owasp.org/Top10/A01_2021-Broken_Access_Control/)
- Real-world: [Polygon faucet abuse 2022](https://forum.polygon.technology/t/faucet-abuse/)
