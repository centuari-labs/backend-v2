# F-19: Chain indexer credits deposits without finality / reorg handling

**Severity**: 🔴 Critical (financial)
**OWASP**: A04 Insecure Design, A08 Software & Data Integrity
**CWE**: CWE-345 (Insufficient Verification of Data Authenticity), CWE-664 (Improper Control of a Resource Through its Lifetime)

## Summary

`ChainIndexerService` reads `Deposited` events from the chain and credits `portfolio.amount` immediately, with no confirmation depth and no reorg compensation logic. The fast-path (`/deposit/confirm`) and the polling path both call `processDepositArgs` for any log seen at the current block tip.

If the chain reorganizes the block out of canonical history, the deposit no longer exists on-chain — but the DB still shows the credit and the user can withdraw it. This is a **direct path to draining the protocol's treasury** on any chain reorg.

## Evidence

`src/chain-indexer/chain-indexer.service.ts:139-187`:

```typescript
private async pollDeposits() {
    const lastProcessedBlock = await this.getLastProcessedBlock();
    const publicClient = this.viemService.getPublicClient(this.chainConfig.chainId);
    const currentBlock = await publicClient.getBlockNumber();   // ⚠️ tip block, not finalized

    if (currentBlock <= lastProcessedBlock) return;

    const fromBlock = lastProcessedBlock + 1n;
    const toBlock = currentBlock - fromBlock > MAX_BLOCK_RANGE
        ? fromBlock + MAX_BLOCK_RANGE
        : currentBlock;

    const logs = await publicClient.getLogs({
        address: this.chainConfig.treasuryAddress as `0x${string}`,
        event: depositedEvent,
        fromBlock,
        toBlock,
    });

    for (const log of logs) {
        const isNew = await this.markAsProcessed(log.transactionHash, log.logIndex);
        if (!isNew) continue;
        const { user, token, amount } = log.args;
        await this.processDepositArgs(user, token, amount, log.transactionHash, log.logIndex);
        // ⚠️ portfolio.amount += amount (no finality check, no reorg path)
    }

    await this.updateLastProcessedBlock(toBlock);
}
```

`processDepositArgs` upserts:

```typescript
await this.portfolioRepository.upsertPortfolio(
    portfolioId,
    account.id,
    tokenEntity.id,
    amount.toString(),
);
```

There is **no logic** anywhere in the indexer that:
- Waits for N confirmations before crediting
- Checks `block.number <= currentBlock - K` (finality buffer)
- Listens for `removed: true` log entries (viem flag for reorged-out logs)
- Decrements / refunds when a previously-processed `txHash` no longer appears in the canonical chain

The fast-path `processTransactionDeposits` is even more aggressive — it acts on a `txHash` the client passes (see F-6) and reads the receipt at any state, including `pending`-confirmed.

## Impact

### Reorg scenarios per supported chain (from `.env`: `SUPPORTED_CHAINS=421614` Arbitrum Sepolia)

- **Arbitrum**: probabilistic finality on L2 sequencer, hard finality requires L1 anchoring (~~12 min). Reorgs of 1–10 blocks are observed in practice on testnet, occasionally on mainnet.
- **Generic L1 / EVM rollups**: reorg depths from 1 to ~64 blocks are normal.

### Attack flow

1. **Trivial natural reorg loss** (no attacker required): user deposits ETH → tx mined in block B → indexer credits → reorg removes B → user has DB credit but no on-chain deposit. Treasury accounting drifts.
2. **Active exploitation** (attacker with sequencer / MEV influence on L2):
   1. Attacker deposits 100 USDC, gets credited.
   2. Attacker withdraws 100 USDC (now indexer state shows 0, but treasury minted shares against 100).
   3. Sequencer reorgs the deposit out (or attacker pays out a sequencer to do so).
   4. Net: attacker withdrew 100 USDC without ever depositing.
3. **Combined with F-6 (`/deposit/confirm` accepts any txHash)**: attacker pushes a `pending` or freshly-included tx hash, indexer credits, then transaction is reverted/dropped/replaced via the mempool. DB credit persists.

### Severity rationale

- Operator capital at risk (the protocol's faucet / treasury holds the funds).
- Drift compounds silently — there is no on-chain ground truth comparison.
- Single-shot reorg → unbounded loss.

## Reproduction (testable on Anvil)

```bash
# 1. Start Anvil with manual block control
anvil --block-time 0 --chain-id 31337

# 2. Snapshot
cast rpc evm_snapshot

# 3. Send a Deposited tx
cast send <treasury> "deposit(...)" --private-key 0x... --value 100ether

# 4. Wait for indexer to credit (poll runs every 60s)
docker exec postgres psql -U centuari -d centuari -c "SELECT * FROM portfolio;"
# row exists with amount=100e18

# 5. Revert to snapshot — Deposited tx is now gone from canonical chain
cast rpc evm_revert <snapshot_id>

# 6. DB still shows the credit. Withdraw it.
curl -X POST http://localhost:8080/withdraw \
    -H "Authorization: Bearer DEV_TOKEN_0x..." \
    -d '{"assetId":"...","amount":"100"}'
# Succeeds. Treasury was never credited on chain. Net loss = 100 ETH.
```

## Recommended Solution

### 1. Wait for confirmations before crediting

`src/chain-indexer/chain-indexer.service.ts`:

```typescript
private static readonly DEPOSIT_CONFIRMATIONS_BY_CHAIN: Record<number, bigint> = {
    1: 12n,        // Ethereum mainnet
    421614: 50n,   // Arbitrum Sepolia (sequencer reorgs observed up to ~10)
    42161: 200n,   // Arbitrum One — wait for L1 anchoring
    // tune per chain
};

private getConfirmations(chainId: number): bigint {
    return ChainIndexerService.DEPOSIT_CONFIRMATIONS_BY_CHAIN[chainId] ?? 12n;
}

private async pollDeposits() {
    const publicClient = this.viemService.getPublicClient(this.chainConfig.chainId);
    const currentBlock = await publicClient.getBlockNumber();
    const confirmations = this.getConfirmations(this.chainConfig.chainId);

    // 🔒 only process up to (currentBlock - confirmations)
    const safeTip = currentBlock - confirmations;
    if (safeTip <= await this.getLastProcessedBlock()) return;

    const fromBlock = (await this.getLastProcessedBlock()) + 1n;
    const toBlock = safeTip - fromBlock > MAX_BLOCK_RANGE
        ? fromBlock + MAX_BLOCK_RANGE
        : safeTip;
    // ... rest unchanged
}
```

For the fast path (`processTransactionDeposits`), reject receipts whose block isn't finalized:

```typescript
async processTransactionDeposits(txHash: string, callerWallet: string): Promise<number> {
    const receipt = await this.viemService.getTransactionReceipt(this.chainConfig.chainId, txHash as Hash);
    if (receipt.status !== "success") return 0;

    const currentBlock = await this.viemService.getPublicClient(this.chainConfig.chainId).getBlockNumber();
    const confirmations = currentBlock - receipt.blockNumber;
    if (confirmations < this.getConfirmations(this.chainConfig.chainId)) {
        throw new BadRequestException(
            `Transaction needs ${this.getConfirmations(this.chainConfig.chainId)} confirmations, has ${confirmations}`
        );
    }
    // ... process
}
```

### 2. Use viem's `getLogs` with `finalized` block tag where supported

```typescript
const logs = await publicClient.getLogs({
    address: this.chainConfig.treasuryAddress,
    event: depositedEvent,
    fromBlock,
    toBlock: "finalized",   // viem-supported on chains with finality tags
});
```

Combine with the confirmation buffer above for chains lacking the tag.

### 3. Handle `removed: true` logs (viem provides this on reorg)

When subscribing via WebSocket / streaming logs, viem emits removed events. Add a corrective path:

```typescript
const unwatch = publicClient.watchEvent({
    address: this.chainConfig.treasuryAddress,
    event: depositedEvent,
    onLogs: (logs) => {
        for (const log of logs) {
            if ((log as any).removed) {
                // 🔄 reorg removed this log — reverse the credit
                this.reverseDeposit(log.transactionHash, log.logIndex)
                    .catch((e) => this.logger.error(`reverse-deposit failed: ${e.message}`));
                continue;
            }
            // normal path
        }
    },
});
```

`reverseDeposit` should:
1. Look up `processed_tx_logs` for the (txHash, logIndex) pair.
2. Decrement the corresponding `portfolio.amount` by the recorded amount (using `BigInt`).
3. Mark the row as reversed (don't delete — keep the audit trail).

```sql
ALTER TABLE processed_tx_logs ADD COLUMN reversed_at TIMESTAMPTZ;
ALTER TABLE processed_tx_logs ADD COLUMN amount NUMERIC(78, 0);  -- store amount for reversal
```

### 4. Periodic reconciliation job

Independent of the indexer, run a cron that reconciles DB credits against on-chain state:

```typescript
@Cron("0 */15 * * * *")  // every 15 min
async reconcile() {
    const rows = await this.databaseService.query<{ tx_hash: string; log_index: number }>(
        `SELECT tx_hash, log_index FROM processed_tx_logs
         WHERE reversed_at IS NULL
           AND created_at > NOW() - INTERVAL '24 hours'`,
    );

    for (const row of rows) {
        const receipt = await this.viemService.getTransactionReceipt(this.chainConfig.chainId, row.tx_hash);
        if (!receipt || receipt.status !== "success") {
            await this.reverseDeposit(row.tx_hash, row.log_index);
            this.logger.warn(`Reconciled missing tx ${row.tx_hash}`);
        }
    }
}
```

This catches reorgs that the live watcher missed (e.g. node downtime).

### 5. Defense in depth — separate "pending credit" vs "available balance"

Introduce two columns: `pending_amount` and `confirmed_amount`. Indexer credits `pending` immediately, then a confirmation-depth job moves `pending → confirmed` after K blocks. Withdrawals only consume `confirmed`.

This keeps UX snappy ("we see your deposit") while preventing reorg abuse.

```sql
ALTER TABLE portfolio
    ADD COLUMN pending_amount NUMERIC(78, 0) DEFAULT 0,
    ADD COLUMN confirmed_amount NUMERIC(78, 0) DEFAULT 0;
```

## Verification

```bash
# 1. Configure a low confirmation count for testing
INDEXER_CONFIRMATIONS_421614=2 pnpm run start:dev

# 2. Send deposit on Anvil
cast send ...

# 3. Mine 1 block (still below confirmation threshold)
cast rpc anvil_mine 1

# 4. Check DB
docker exec postgres psql -U centuari -d centuari -c "SELECT amount FROM portfolio WHERE ...;"
# Expected: 0 (not yet credited)

# 5. Mine 1 more block (>=2 confirmations)
cast rpc anvil_mine 1

# 6. Wait 60s for poll
docker exec postgres psql -U centuari -d centuari -c "SELECT amount FROM portfolio WHERE ...;"
# Expected: deposit amount

# 7. Reorg test
cast rpc evm_snapshot
# ... deposit, credit, then revert
cast rpc evm_revert <id>
# Run reconciliation
docker exec backend node -e "/* trigger reconcile */"
docker exec postgres psql -U centuari -d centuari -c "SELECT amount, reversed_at FROM portfolio JOIN processed_tx_logs ...;"
# Expected: reversed_at IS NOT NULL, amount decremented
```

## References

- [Arbitrum: Block finality](https://docs.arbitrum.io/inside-arbitrum-nitro/#block-finality)
- [viem: watchEvent and removed flag](https://viem.sh/docs/actions/public/watchEvent.html)
- [Ethereum reorgs in practice](https://ethresear.ch/t/anatomy-of-reorgs/)
- [CWE-345: Insufficient Verification of Data Authenticity](https://cwe.mitre.org/data/definitions/345.html)
- Prior art: [Wormhole reorg handling docs](https://docs.wormhole.com/wormhole/explore-wormhole/blocks)
