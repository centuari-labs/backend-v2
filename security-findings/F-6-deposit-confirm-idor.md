# F-6: `/deposit/confirm` accepts arbitrary txHash

**Severity**: 🟠 High
**OWASP**: A01 Broken Access Control, A04 Insecure Design
**CWE**: CWE-863 (Incorrect Authorization), CWE-770 (Resource Exhaustion)

## Summary

The `POST /deposit/confirm` endpoint runs `AuthGuard`, but the underlying `confirmDeposit(txHash)` service method neither receives nor verifies the caller's wallet. Consequences:

1. **DoS amplifier**: every authenticated request triggers a chain RPC call (`processTransactionDeposits`).
2. **Side effects via foreign tx**: may trigger indexer state mutations for transactions that don't belong to the caller.
3. **Information disclosure**: 500 errors leak the `viem` library version and transaction hash details.

## Evidence

`src/deposit/deposit.controller.ts:38-43`:
```typescript
@Post("confirm")
@UseGuards(AuthGuard)
async confirmDeposit(
    @Body() dto: ConfirmDepositDto,
): Promise<ConfirmDepositResponseDto> {
    return this.depositService.confirmDeposit(dto.txHash);  // ⚠️ no wallet
}
```

`src/deposit/deposit.service.ts:83`:
```typescript
async confirmDeposit(txHash: string): Promise<ConfirmDepositResponseDto> {
    const processed =
        await this.chainIndexerService.processTransactionDeposits(txHash);
    // ⚠️ no ownership check — accepts any txHash
    return { processed };
}
```

### Active test

```bash
$ curl -s -X POST http://localhost:8080/deposit/confirm \
    -H "Authorization: Bearer DEV_TOKEN_0x1111111111111111111111111111111111111111" \
    -d '{"txHash":"0x0000000000000000000000000000000000000000000000000000000000000000"}'

{"success":false,"message":"Internal server error: Transaction receipt with hash \"0x0000...\" could not be found.\n\nVersion: viem@2.38.6","statusCode":500}

# 500 error leaks the viem version

$ curl -s -X POST http://localhost:8080/deposit/confirm \
    -H "Authorization: Bearer DEV_TOKEN_0x1111..." \
    -d '{"txHash":"0x8bd5b48307a520f3152a39e5e6741cbb57a95ead4e4e3960502a3d3197f44fac"}'

{"statusCode":201,"data":{"processed":0}}
# Returns 201 even though the tx isn't the caller's deposit
```

## Impact

- **F-6.1 — RPC quota burn**: 1 request = 1 RPC `getTransactionReceipt` call. Combined with F-2 (no rate limit), an attacker can loop thousands of requests and exhaust the Alchemy/Infura quota.
- **F-6.2 — Side effects on foreign tx**: if `processTransactionDeposits` writes to the DB (indexer state, etc.) for a tx belonging to another user, state corruption is possible.
- **F-6.3 — Info disclosure**: stack traces and library versions in the response. Helps attackers fingerprint the stack for targeted exploits.

## Recommended Solution

### 1. Bind txHash to the caller wallet

`src/deposit/deposit.service.ts`:

```typescript
async confirmDeposit(
    txHash: string,
    callerWallet: string,
): Promise<ConfirmDepositResponseDto> {
    // Fetch the tx receipt to verify the caller is involved
    const receipt = await this.viemService.getTransactionReceipt(
        this.chainConfig.chainId,
        txHash,
    );

    if (!receipt) {
        throw new NotFoundException("Transaction not found or not yet confirmed");
    }

    // Verify caller is from/to of tx, OR is recipient in any Transfer event
    const callerLower = callerWallet.toLowerCase();
    const isParticipant =
        receipt.from?.toLowerCase() === callerLower ||
        receipt.to?.toLowerCase() === callerLower ||
        receipt.logs.some(log => isTransferToCaller(log, callerLower));

    if (!isParticipant) {
        throw new ForbiddenException("Transaction does not involve caller wallet");
    }

    const processed = await this.chainIndexerService.processTransactionDeposits(txHash);
    return { processed };
}

private isTransferToCaller(log: Log, callerLower: string): boolean {
    // ERC-20 Transfer topic
    const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
    if (log.topics[0] !== TRANSFER_TOPIC) return false;
    const toAddr = "0x" + log.topics[2]?.slice(26);
    return toAddr?.toLowerCase() === callerLower;
}
```

Update the controller:

```typescript
@Post("confirm")
@UseGuards(AuthGuard)
async confirmDeposit(
    @Body() dto: ConfirmDepositDto,
    @Wallet() walletAddress: string,
): Promise<ConfirmDepositResponseDto> {
    return this.depositService.confirmDeposit(dto.txHash, walletAddress);
}
```

### 2. Strip stack traces from 500 responses

See **[F-14](./F-14-error-info-disclosure.md)** — fix `AllExceptionsFilter` to return generic messages to the client and log details server-side.

### 3. Idempotency check

Prevent reprocessing the same txHash:

```typescript
const alreadyProcessed = await this.processedTxLogsRepo.findOne({
    where: { txHash: dto.txHash, walletAddress: callerWallet.toLowerCase() }
});
if (alreadyProcessed) {
    return { processed: 0, alreadyConfirmed: true };
}
```

(The `processed_tx_logs` table already exists per `\dt` output — leverage it.)

### 4. Per-wallet rate limit

Handled by **F-2** (global throttler). Specifically, add:

```typescript
@Throttle({ default: { limit: 30, ttl: 60000 } })  // 30/min/wallet
```

## Verification

```bash
# After fix:
# Foreign tx → 403
curl -X POST http://localhost:8080/deposit/confirm \
  -H "Authorization: Bearer DEV_TOKEN_0xVICTIM..." \
  -d '{"txHash":"0xATTACKER_TX..."}'
# Expected: 403 Forbidden

# Own tx → 201 (or 200 on idempotent retry)
curl -X POST http://localhost:8080/deposit/confirm \
  -H "Authorization: Bearer DEV_TOKEN_0xMY_WALLET..." \
  -d '{"txHash":"0xMY_DEPOSIT_TX..."}'
# Expected: 201 with processed > 0

# Invalid hash → 400/404 with generic message (no stack)
curl -X POST http://localhost:8080/deposit/confirm \
  -H "Authorization: Bearer DEV_TOKEN_0xMY_WALLET..." \
  -d '{"txHash":"0x0"}'
# Expected: 400 "Invalid transaction hash format" (no viem version)
```

## References

- [OWASP A01:2021 — Broken Access Control](https://owasp.org/Top10/A01_2021-Broken_Access_Control/)
- [Ethereum: Verifying transaction ownership](https://ethereum.org/en/developers/docs/transactions/)
