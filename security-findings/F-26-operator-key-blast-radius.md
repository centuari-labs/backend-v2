# F-26: Operator key signs every user action — backend is the sole authorization layer

**Severity**: 🔴 Critical (architectural)
**OWASP**: A01 Broken Access Control, A04 Insecure Design, A07 Identification & Auth Failures
**CWE**: CWE-272 (Least Privilege Violation), CWE-345 (Insufficient Verification of Data Authenticity)

## Summary

Every on-chain user action (`Treasury.withdraw`, `Centuari.withdrawLendPosition`, `Centuari.repay`, faucet mint) is signed by the single `OPERATOR_PRIVATE_KEY`. The contract calls don't carry a user signature — the contract trusts the operator and the **backend** is the only place user authorization is checked. Bot accounts used by the order worker are also derived deterministically from the same operator key, so a single compromised key controls:

- The treasury's withdraw key
- The repay key
- The faucet
- All bot wallets (and their positions)

Combined with **F-1** (operator key checked into `.env`), this means anyone with read access to the repo can drain the protocol on chain. Combined with **F-9 / F-15 / F-20 / F-25** (each lets an attacker manipulate the backend's view of what's authorized), an attacker doesn't even need the key — they can trick the backend into having the operator sign a malicious tx.

## Evidence

### Withdraw — operator signs

`src/withdraw/withdraw.service.ts:140-154`:

```typescript
const receipt = (await this.viemService.writeContract(
    this.chainConfig.chainId,
    this.chainConfig.operatorPrivateKey,    // ⚠️ operator signs
    this.chainConfig.treasuryAddress,
    treasuryAbi,
    "withdraw",
    [token.tokenAddress, walletAddress, amountInBaseUnits],
    { waitForReceipt: true },
));
```

The `walletAddress` here is whatever the backend supplies. The contract has no `msg.sender == user` check — `msg.sender` is the operator. Authorization is entirely the backend's responsibility.

### Repay — operator signs

`src/portfolio/repay.service.ts:162` calls into:

```typescript
this.viemService.writeContract(
    chainId,
    this.chainConfig.operatorPrivateKey,
    centuariAddress,
    centuariAbi,
    "repay",
    [marketId, borrower, amount],
)
```

### Withdraw lend position — operator signs

`src/portfolio/portfolio.service.ts:1037` — `executeBlockchainWithdraw(...)` for matured lend positions, also operator-signed.

### Faucet — operator signs

`src/faucet/faucet.service.ts:159, 251` — operator key used for the faucet's `mint`/`transfer` calls.

### Bot accounts derive from the operator key

`src/orders/orders.worker.ts:170-189`:

```typescript
private deriveBotAccounts(): BotAccount[] {
    const operatorKey = this.configService.get<string>("OPERATOR_PRIVATE_KEY");
    const formattedKey = operatorKey.startsWith("0x") ? operatorKey : `0x${operatorKey}`;

    return Array.from({ length: NUM_BOT_ACCOUNTS }, (_, i) => {
        const derivedKey = keccak256(toHex(`${formattedKey}-bot-${i}`));   // ⚠️ deterministic
        const account = privateKeyToAccount(derivedKey as `0x${string}`);
        return {
            privateKey: derivedKey,
            wallet: account.address,
            privyUserId: `did:privy:worker-bot-${i}`,
        };
    });
}
```

Anyone holding the operator key can compute every bot key with a one-line `keccak256` call. The bot accounts hold real assets (the worker funds them via faucet + treasury deposit) and place real orders.

## Impact

### A. Direct key compromise (already feasible via F-1)

The `.env` file in the repo contains `OPERATOR_PRIVATE_KEY=0x711a4f...c25256` (Arbitrum Sepolia). Anyone with read access to the repo (or its Git history) can:

1. Drain the treasury wallet's gas balance.
2. Compute every bot's private key, drain their token balances.
3. On chains that don't gate the contracts by an operator allowlist, call any user-action method directly — withdraw any user's collateral, repay any user's debt to themselves, etc. (depends on the contract's access control; if `Treasury.withdraw` is `onlyOperator`, the attacker IS the operator now.)

### B. Indirect exploitation via backend authorization bypass

The backend is the sole authorization layer. Any finding that lets an attacker manipulate the backend's view of state effectively gets them an operator-signed transaction:

- **F-9 (access-code race)** → attacker bypasses access gate → places orders / withdraws.
- **F-15 (WS no auth)** → attacker spies on victim's positions to choose targets.
- **F-16 / F-23 (precision drift)** → attacker pushes balance just past a check; operator signs an over-withdrawal.
- **F-18 (NATS forge)** → attacker injects fake fills / cancels into the gateway and matching engine; backend reconciles state and asks the operator to settle.
- **F-20 (cross-asset markets)** → attacker re-points an order, operator-signed settlement happens against the wrong asset.
- **F-24 (oracle blank price)** → HF reports `Infinity`, withdraw passes, operator signs withdrawal.
- **F-25 (cancel race)** → DB shows no fill, but on-chain settlement happened. Reconciliation can ask the operator to "unwind", which signs a malicious tx.

In every case, the on-chain protocol can't tell the difference between a legitimate user request and a manipulated one — the operator's signature is on both.

### C. Bot account compromise

Bot accounts have real positions on chain. With the operator key public:

- Drain bot wallets directly (transfer their tokens to attacker).
- Place bot orders against real users that always lose, draining bot capital into attacker-controlled lend orders.
- Use bot accounts as a credible trading counterparty in wash-trading / oracle-manipulation schemes (since bots have history).

### D. Single point of failure

All four roles (treasury withdraw signer, repay signer, faucet signer, bot key seed) collapse to one key. There is no rotation primitive, no role separation, no break-glass.

## Recommended Solution

### 1. Rotate immediately (handled in F-1)

Generate a new operator key, transfer treasury balance to the new wallet, deprecate the old. **Don't reuse the old key for bots.**

### 2. Split keys by role

Run distinct keys for distinct functions and load each from a separate vault entry:

| Role | Env var | Allowed contract calls |
|------|---------|-------------------------|
| Treasury withdraw signer | `WITHDRAW_OPERATOR_KEY` | `Treasury.withdraw` only |
| Lend/repay settlement signer | `SETTLEMENT_OPERATOR_KEY` | `Centuari.withdrawLendPosition`, `Centuari.repay` |
| Faucet signer | `FAUCET_OPERATOR_KEY` | `Faucet.mint*` only |
| Bot wallets | seeded from a separate `BOT_SEED` (NOT the operator key) | place orders only |

Update `chain-config.service.ts`:

```typescript
readonly withdrawOperatorKey: string;
readonly settlementOperatorKey: string;
readonly faucetOperatorKey: string;
readonly botSeed: string;
```

Each contract method should be `onlyRole(specificRole)` with the role granted only to the relevant key. A leak of one key only burns that key's authority.

### 3. Use a key-management service / HSM

Replace plaintext env keys with one of:
- AWS KMS sign-only (`asymmetricSign` API; private key never leaves KMS).
- GCP Cloud KMS / HashiCorp Vault Transit.
- A managed signer service (Fireblocks, Defender Relayer, Gelato).

The backend asks the KMS to sign a pre-built unsigned tx. The key is never in process memory or on disk.

### 4. Move authorization on-chain where possible

The current model is: backend checks ownership → operator signs. Whenever feasible, accept a user-signed payload and let the contract verify:

- **EIP-712 typed signatures** for `withdraw` / `repay`: user signs `{action: "withdraw", asset, amount, nonce, deadline}`. Contract recovers signer and only allows the operation for that signer's account.
- **Account abstraction (ERC-4337)** so users can submit gasless txs that carry their own signature.
- **Permit2** for token allowances, so the operator never holds approval over the user's tokens.

This shrinks the blast radius: even if the operator key is compromised, an attacker can't move user funds without a user-signed permit.

### 5. Bot key seed — separate, dedicated

```typescript
// orders.worker.ts
private deriveBotAccounts(): BotAccount[] {
    const seed = this.configService.get<string>("BOT_SEED");
    if (!seed) throw new Error("BOT_SEED is not configured");

    return Array.from({ length: NUM_BOT_ACCOUNTS }, (_, i) => {
        const derivedKey = keccak256(toHex(`${seed}-bot-${i}`));
        const account = privateKeyToAccount(derivedKey as `0x${string}`);
        return { privateKey: derivedKey, wallet: account.address, privyUserId: `did:privy:worker-bot-${i}` };
    });
}
```

Generate a fresh seed (`openssl rand -hex 32`), separate from any operator key, store in vault.

### 6. Defense in depth — operator allowance caps on chain

Even with a single operator role, the contract can rate-limit the operator:

```solidity
mapping(address => uint256) public dailyWithdrawn;
mapping(address => uint256) public lastReset;

modifier dailyCap(uint256 amount) {
    if (block.timestamp - lastReset[msg.sender] > 1 days) {
        dailyWithdrawn[msg.sender] = 0;
        lastReset[msg.sender] = block.timestamp;
    }
    require(dailyWithdrawn[msg.sender] + amount <= DAILY_OPERATOR_CAP, "operator cap exceeded");
    dailyWithdrawn[msg.sender] += amount;
    _;
}
```

A compromised key burns at most one day's cap before someone notices and rotates.

### 7. Monitoring + tripwires

Alert on:
- Operator txs above per-user/per-day thresholds.
- Operator activity outside business hours.
- Repeated `withdraw` to addresses that haven't deposited.
- Faucet calls > N/day to the same recipient.

These are the kinds of signatures that would surface key compromise before the treasury is fully drained.

## Verification

```bash
# 1. After rotation, verify the env keys are not in repo:
git log -p -- .env | grep -i "operator\|private_key"     # Expected: empty after F-1 history scrub
gitleaks detect --no-git --report-path /tmp/gl.json && jq '. | length' /tmp/gl.json   # 0

# 2. After role separation, the bot derivation should not use the operator key:
grep -rn "OPERATOR_PRIVATE_KEY" src --include="*.ts"
# Expected: only in chain-config.service.ts, not in orders.worker.ts

# 3. Contract-side verification (off-repo):
# Confirm Treasury.withdraw is onlyRole(WITHDRAW_ROLE) and the role is granted only to WITHDRAW_OPERATOR_KEY.
```

## References

- [OpenZeppelin Defender Relayer](https://docs.openzeppelin.com/defender/v2/manage/relayers) — managed signer with key in HSM
- [Permit2 — Uniswap](https://blog.uniswap.org/permit2-and-universal-router) — user-signed allowances
- [EIP-712: Typed structured data hashing and signing](https://eips.ethereum.org/EIPS/eip-712)
- [AWS KMS for Ethereum signing](https://aws.amazon.com/blogs/database/sign-ethereum-transactions-with-aws-kms-and-golang/)
- [CWE-272: Least Privilege Violation](https://cwe.mitre.org/data/definitions/272.html)
- Real-world: [Multichain $130M operator-key compromise (2023)](https://rekt.news/multichain-rekt2/)
