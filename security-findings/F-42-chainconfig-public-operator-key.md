# F-42: `ChainConfigService` exposes `operatorPrivateKey` as a public readonly field

**Severity**: 🟡 Moderate (compounds F-26)
**OWASP**: A04 Insecure Design, A02 Cryptographic Failures
**CWE**: CWE-1247 (Improper Handling of Secrets in Code), CWE-540 (Inclusion of Sensitive Information in Source Code), CWE-732 (Incorrect Permission Assignment for Critical Resource)

## Summary

`ChainConfigService` reads `OPERATOR_PRIVATE_KEY` from `ConfigService` and stores it in a `public readonly` field of the same name. Every NestJS provider that injects `ChainConfigService` therefore has direct access to the raw private-key string. Today that includes `WithdrawService`, `RepayService`, `PortfolioService` (via `executeBlockchainWithdraw`), `OrdersWorker`, and `FaucetService`. The number of class instances holding a reference to the cleartext key is unnecessarily large, and any future debug-logging, error-tracing, Sentry-style scoop, or test-doubles that stringify the service spreads the key further.

The design constraint (per **F-26**) that the operator key signs every on-chain user action is the underlying issue. This finding is the narrower architectural symptom: the key is held as a freely-readable property on a widely-injected service.

## Evidence

`src/core/chain-config/chain-config.service.ts:1-22`:

```typescript
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class ChainConfigService {
    readonly chainId: number;
    readonly operatorPrivateKey: string;          // ⚠️ public, plaintext
    readonly treasuryAddress: string;
    readonly centuariAddress: string;

    constructor(private readonly configService: ConfigService) {
        this.chainId = Number(
            configService.get<string>("DEPOSIT_CHAIN_ID") ?? "421614",
        );
        this.operatorPrivateKey =
            configService.get<string>("OPERATOR_PRIVATE_KEY") ?? "";
        this.treasuryAddress =
            configService.get<string>("TREASURY_ADDRESS") ?? "";
        this.centuariAddress =
            configService.get<string>("CENTUARI_ADDRESS") ?? "";
    }
}
```

Consumers:

```bash
$ grep -rn "chainConfig.operatorPrivateKey\|this\.chainConfig\.operatorPrivateKey" src --include="*.ts" \
    | grep -v "test\|spec"

src/portfolio/portfolio.service.ts:1037:    this.chainConfig.operatorPrivateKey,
src/portfolio/repay.service.ts:162:                this.chainConfig.operatorPrivateKey,
src/withdraw/withdraw.service.ts:148:                    this.chainConfig.operatorPrivateKey,
```

Plus `OrdersWorker` and `FaucetService` read `OPERATOR_PRIVATE_KEY` directly from `ConfigService.get(...)` rather than from `chainConfig` — a separate concern, but it doubles the number of code paths that touch the cleartext key.

### Default to empty string

```typescript
this.operatorPrivateKey =
    configService.get<string>("OPERATOR_PRIVATE_KEY") ?? "";
```

If the env var is unset, the field silently becomes `""`. Downstream `viem` calls then throw `Invalid private key` at runtime instead of failing at startup. The boot path doesn't refuse to start with a missing operator key — meaning a misconfigured deploy gets `200`s on read endpoints but `500`s on every write endpoint, and operator-action runtime errors leak to logs and clients.

## Impact

- **F-42.1 — Wide-blast accidental disclosure**: any future change that stringifies the service (e.g. NestJS' built-in `inspect` for circular DI debugging, a custom logger that includes `JSON.stringify(this)`, a Sentry breadcrumb that captures a request handler with this service in scope) leaks the key. A class with a public `operatorPrivateKey: string` is one careless serialization away from a global-scope log of the key.
- **F-42.2 — Test fixtures**: jest mocks already serialize the service (`createMockChainConfig` etc.) and prior commits in this repo show `0xOperatorPrivateKey`-shaped placeholders in `dist/__test__/...` (per F-33). A future test that imports the real service for a wider integration test ends up with the real key in test logs and CI artifacts.
- **F-42.3 — Heap inspection**: in a containerized deploy, anyone with shell access (kubectl exec, ECS exec, host SSH) can dump the Node process and `grep '0x[0-9a-f]{64}'` to find the key. Encapsulating the key behind a method that pulls just-in-time, or behind a proxy that signs but never returns the key, makes shell-access still serious but materially harder to weaponize.
- **F-42.4 — Default-empty-string failure mode**: a misconfigured deploy starts up "fine" and only fails on the first write call with a viem error message that may include parts of the empty string and `walletAddress`. Combined with **F-14** (info disclosure in error responses), the failure is loud and informative for an attacker.
- **F-42.5 — Compound with F-26**: F-26 is the root architectural concern (single key signs everything). F-42 is the narrower implementation issue: even *given* that you hold a single operator key, holding it as a freely-readable property is unnecessarily generous to attackers and to the maintenance burden.

## Recommended Solution

### 1. Refuse to start when the key is missing

```typescript
constructor(private readonly configService: ConfigService) {
    this.chainId = Number(
        configService.get<string>("DEPOSIT_CHAIN_ID") ?? "421614",
    );

    const operatorKey = configService.get<string>("OPERATOR_PRIVATE_KEY");
    if (!operatorKey || !/^0x[0-9a-fA-F]{64}$/.test(operatorKey)) {
        throw new Error(
            "OPERATOR_PRIVATE_KEY must be set and look like a 32-byte hex string",
        );
    }
    this.#operatorPrivateKey = operatorKey;
    ...
}
```

Combined with F-32 (NODE_ENV-gated dev auth) and F-34 (gate migrations on start), the boot path now refuses to come up with any combination of insecure / missing config.

### 2. Hide the key behind a private field + minimal accessors

Use a private field and a single typed accessor that returns a viem `WalletClient`, not the raw key:

```typescript
@Injectable()
export class ChainConfigService {
    readonly chainId: number;
    readonly treasuryAddress: string;
    readonly centuariAddress: string;
    readonly #operatorPrivateKey: string;             // ⬅ private (TC39 hash field)

    constructor(private readonly configService: ConfigService, private readonly viemService: ViemService) {
        // ... validation as above
        this.#operatorPrivateKey = operatorKey;
    }

    /**
     * Returns a viem wallet client signing as the operator on the given chain.
     * Callers that need to send a tx call this — they never see the raw key.
     */
    getOperatorWalletClient(chainId: number) {
        return this.viemService.getWalletClient(this.#operatorPrivateKey, chainId);
    }
}
```

Refactor the three current `this.chainConfig.operatorPrivateKey` callers to use `this.chainConfig.getOperatorWalletClient(...)` directly. The raw string never escapes the class.

### 3. Replace `OPERATOR_PRIVATE_KEY` with a remote signer

The deeper fix (per F-26) is to never have a private key in process memory at all:

```typescript
// Pseudocode — pluggable signer that talks to KMS / Defender / Fireblocks.
@Injectable()
export class OperatorSigner {
    constructor(private readonly kms: KmsClient) {}

    async signTransaction(chainId: number, tx: TransactionRequest): Promise<Hex> {
        const unsigned = await this.viem.prepareTransactionRequest({ ...tx, chainId });
        const sig = await this.kms.sign({
            keyId: process.env.OPERATOR_KMS_KEY_ID!,
            message: hashTx(unsigned),
        });
        return assembleSigned(unsigned, sig);
    }
}
```

Now no service in the codebase has a property that holds the cleartext key. The closest you get is a `keyId` reference. Heap dumps reveal nothing useful; debug logs can include the keyId without exposing the key; tests stub the signer.

This is the same recommendation as F-26 §3, restated at the field-encapsulation layer.

### 4. Lint rule: forbid `operatorPrivateKey` as a field name on public surfaces

Once the refactor is done, add a Semgrep rule that fails CI if the field re-appears:

```yaml
rules:
  - id: no-public-operator-key
    message: "Do not expose operatorPrivateKey as a class field. Use OperatorSigner."
    languages: [typescript]
    pattern-either:
      - pattern: |
          class $C {
            ...
            $V: string
            ...
          }
        metavariable-pattern:
          metavariable: $V
          pattern-regex: ^.*[Pp]rivateKey$
        severity: ERROR
```

### 5. Mask in logs

Audit every log statement that includes a service instance / config object:

```bash
$ grep -rnE "logger\.(log|debug|info|warn|error).*chainConfig" src --include="*.ts"
```

For each, ensure no full key is interpolated. Add a `toJSON()` to `ChainConfigService` that explicitly redacts:

```typescript
toJSON() {
    return {
        chainId: this.chainId,
        treasuryAddress: this.treasuryAddress,
        centuariAddress: this.centuariAddress,
        operatorPrivateKey: "[REDACTED]",
    };
}
```

`JSON.stringify(chainConfig)` now produces `[REDACTED]` instead of the key — a backstop for future stringification mistakes.

## Verification

```bash
# 1. Boot-time validation
OPERATOR_PRIVATE_KEY= pnpm run start
# Expected: process exits with the explicit error.

OPERATOR_PRIVATE_KEY=not-hex pnpm run start
# Expected: same.

OPERATOR_PRIVATE_KEY=0x711a4fea6743d55316574035583dcfddd14d5bd62495cee428d56b6ab7c25256 pnpm run start
# Expected: starts (assuming everything else is configured).

# 2. Field encapsulation
node -e "
const { ChainConfigService } = require('./dist/core/chain-config/chain-config.service');
const svc = new ChainConfigService(/* configService stub */);
console.log(JSON.stringify(svc));
"
# Expected: no '0x[64 hex chars]' in output.

# 3. Lint rule fires on regression
echo 'class T { operatorPrivateKey: string; }' > /tmp/t.ts
semgrep --config .semgrep.yml /tmp/t.ts
# Expected: rule fires, exit code != 0.
```

## References

- [TC39 private fields (`#field`)](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes/Private_class_fields)
- [OWASP A04:2021 — Insecure Design](https://owasp.org/Top10/A04_2021-Insecure_Design/)
- [CWE-1247: Improper Handling of Secrets in Code](https://cwe.mitre.org/data/definitions/1247.html)
- [Heap-dump exfil mitigations](https://nodejs.org/en/learn/diagnostics/memory) — operational counterparts
- See also F-1 (env hygiene), F-26 (operator-key blast radius), F-33 (dist build artifacts)
