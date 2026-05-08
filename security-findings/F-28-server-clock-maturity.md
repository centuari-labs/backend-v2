# F-28: `withdrawLendPosition` gates maturity on the server clock, not the chain clock

**Severity**: 🟡 Moderate
**OWASP**: A04 Insecure Design
**CWE**: CWE-367 (Time-of-check Time-of-use Race), CWE-672 (Operation on a Resource after Expiration or Release)

## Summary

`PortfolioService.withdrawLendPosition` decides whether a position has matured by comparing `Date.now()` (server wall clock) against `market.maturity` (DB datetime). The on-chain settlement contract uses `block.timestamp`. The two clocks are not synchronized, and the inconsistency creates two failure modes:

1. **Server clock ahead of chain** → backend says matured, contract reverts.
2. **Server clock behind chain** → contract would accept, backend rejects.

In both cases, every retry until clocks converge wastes operator gas (the backend signs the on-chain call) and creates a window where legitimate withdrawals are blocked or buggy retries are auto-driven.

## Evidence

`src/portfolio/portfolio.service.ts:976-984`:

```typescript
const maturityDate = market.maturity ? new Date(market.maturity) : null;
if (!maturityDate) {
    throw new BadRequestException("Market has no maturity date");
}

const maturityUnix = Math.floor(maturityDate.getTime() / 1000);
const nowUnix = Math.floor(Date.now() / 1000);    // ⚠️ server clock
if (nowUnix < maturityUnix) {
    throw new BadRequestException("Position has not matured yet");
}
```

The on-chain contract presumably checks `block.timestamp >= maturity`. If the backend host's NTP drifts (e.g. on a misconfigured EC2 instance, container clock skew, etc.), the two checks disagree.

The same `now-vs-maturity` pattern appears in:

```bash
grep -rn "Date.now() / 1000\|getTime() / 1000" src --include="*.ts" | grep -v test
```

(common spot fix: replace each with chain-time-aware logic, see below.)

## Impact

- **Operator gas burn**: server clock ahead → backend submits the on-chain `withdrawLendPosition` → contract reverts (`maturity > block.timestamp`). Operator (per F-26) just paid gas for nothing. Repeat until block.timestamp catches up.
- **Legitimate withdrawals blocked**: server clock behind → on-chain is matured but backend refuses. Users see "Position has not matured yet" indefinitely.
- **Race-condition near maturity**: a withdraw initiated exactly at maturity might pass backend, then the chain `block.timestamp` is slightly ahead and the contract still accepts — fine. But two concurrent calls plus F-27 (no transaction wrapping) plus a clock-skew window can produce a tx that the backend thinks is settling a matured position while the contract treats it as unmatured.
- **Trust-boundary issue**: server time is mutable by the operator/host. A misconfigured (or compromised) host clock can cause the backend to authorize on-chain operations the contract would reject — wasting operator gas and creating noise that masks intentional attacks.

## Reproduction

```bash
# 1. Confirm a market with maturity=NOW + 60s.
docker exec postgres psql -U centuari -d centuari -c \
    "INSERT INTO markets (id, asset_id, maturity) VALUES ('11111111-1111-4111-8111-111111111111', '<asset>', NOW() + INTERVAL '60 seconds');"

# 2. Set the backend container's clock 5 minutes ahead.
docker exec backend bash -c "date -s '@$(($(date +%s) + 300))'"   # requires SYS_TIME cap

# 3. With a position in that market, call withdraw-lend-position.
curl -X POST http://localhost:8080/portfolio/withdraw-lend-position \
    -H "Authorization: Bearer DEV_TOKEN_0x..." \
    -d '{"marketId":"11111111-1111-4111-8111-111111111111"}'

# Backend says "matured" → executes on-chain tx → contract reverts because
# block.timestamp < maturity. Operator gas burned.
```

## Recommended Solution

### 1. Use `block.timestamp` from the chain

`src/portfolio/portfolio.service.ts`:

```typescript
const publicClient = this.viemService.getPublicClient(this.chainConfig.chainId);
const latestBlock = await publicClient.getBlock({ blockTag: "latest" });
const chainNowUnix = Number(latestBlock.timestamp);

if (chainNowUnix < maturityUnix) {
    throw new BadRequestException(
        `Position has not matured yet (chain time: ${chainNowUnix}, maturity: ${maturityUnix})`,
    );
}
```

The chain's view of "now" is the only one the contract will accept.

### 2. Add a small grace buffer

Even with chain timestamp, `block.timestamp` can drift slightly between blocks. Add a few seconds of buffer to avoid edge-of-block flapping:

```typescript
const MATURITY_BUFFER_SEC = 30;
if (chainNowUnix + MATURITY_BUFFER_SEC < maturityUnix) {
    throw new BadRequestException("Position has not matured yet");
}
```

### 3. Cache `chainNowUnix` briefly

Calling `getBlock` for every `withdrawLendPosition` adds an RPC round-trip. Cache for a few seconds:

```typescript
private chainTimeCache = { value: 0n, expiresAt: 0 };
private async getChainTimestamp(): Promise<bigint> {
    const now = Date.now();
    if (this.chainTimeCache.expiresAt > now) return this.chainTimeCache.value;
    const block = await this.viemService.getPublicClient(this.chainConfig.chainId)
        .getBlock({ blockTag: "latest" });
    this.chainTimeCache = { value: block.timestamp, expiresAt: now + 5_000 };
    return block.timestamp;
}
```

### 4. NTP discipline (operational, defense in depth)

In production, ensure the backend host runs `chronyd` / `ntpd` against a public NTP pool. Container deployments: mount `/etc/localtime` and run with `--cap-add=SYS_TIME` only if you trust the runtime. Most production container platforms (ECS, EKS, GKE) sync hosts automatically; verify this is true for your deployment.

### 5. Audit other server-clock vs chain-clock comparisons

```bash
$ grep -rnE "Date\.now\(\)|getTime\(\)" src --include="*.ts" | grep -v "test\|spec"
```

For each hit, decide:

- Is this a TTL/cache (server-only)? Keep `Date.now()`.
- Is this a money-affecting comparison (maturity, expiration, on-chain timing)? Switch to chain timestamp.

Likely candidates beyond `withdrawLendPosition`:
- `repay.service.ts` — `getOnChainDebt` precondition (none currently, but anything checking expiry)
- Order matching auto-rollover trigger time
- Access code expiration (`expires_at` checked against `new Date()` — fine, it's a server policy date, not a chain commitment).

## Verification

```bash
# Skew test: set backend clock ahead 5 minutes, assert withdraw is rejected with the chain-time message.
# (See reproduction; expect the new error to mention chain time, not server time.)

# RPC failure path: simulate a chain RPC outage and assert withdrawLendPosition throws ServiceUnavailable
# instead of falling back to server clock.
```

## References

- [Ethereum Yellow Paper — `block.timestamp`](https://ethereum.github.io/yellowpaper/paper.pdf) (semantics + bounds)
- [CWE-367: TOCTOU](https://cwe.mitre.org/data/definitions/367.html)
- [Chronicle: Timestamp gotchas in DeFi](https://chronicleprotocol.org/) (operational reference)
