# F-1: Secrets committed to repo (`.env`)

**Severity**: 🔴 Critical
**OWASP**: A02 Cryptographic Failures, A05 Security Misconfiguration
**CWE**: CWE-540 (Inclusion of Sensitive Information in Source Code)

## Summary

The `.env` file is committed to the repo and contains production-grade secrets including operator private keys that control on-chain operations.

## Evidence

```
$ docker run --rm -v $PWD:/path zricethezav/gitleaks:latest detect --source=/path --no-git
38 leaks found
```

Detected secrets in `.env`:

| Line | Variable | Risk |
|------|----------|------|
| 14 | `PRIVY_APP_ID=cmfmmomww016fjl0bee9i2ds4` | Auth provider identifier — low risk but still should not be committed |
| 15 | `PRIVY_PROJECT_SECRET=privy_app_secret_4g7DCTB...` | **Privy server-side secret** — could be used to forge auth tokens |
| 28 | `OPERATOR_PRIVATE_KEY=0x59c6...8690d` (Anvil) | Anvil dev key — public, low risk |
| 36 | `OPERATOR_PRIVATE_KEY=0x711a4f...c25256` (Arbitrum Sepolia) | **Production-style operator key** — controls faucet, order worker, treasury |
| 53 | `ACCESS_CODE_ADMIN_SECRET=0xac09...2ff80` | Admin endpoint master key |

## Impact

- **F-1.1**: An attacker with read access to the repo can immediately drain the operator balance via the faucet.
- **F-1.2**: A leaked Privy project secret enables forging user JWTs and impersonating users.
- **F-1.3**: A leaked `ACCESS_CODE_ADMIN_SECRET` allows generating unlimited access codes (combined with F-9 to distribute them).
- **F-1.4**: Even if `.env` is removed now, Git history retains the values.

## Reproduction

```bash
git clone git@github.com:centuari-labs/backend-v2.git
cat backend-v2/.env  # secrets are written in plaintext
```

## Recommended Solution

### 1. Stop the bleeding (immediate)

```bash
# Remove .env from tracking
git rm --cached .env
echo ".env" >> .gitignore
git commit -m "chore: untrack .env"
```

### 2. Rotate all secrets

| Secret | Action |
|--------|--------|
| `PRIVY_PROJECT_SECRET` | Generate a new one in the Privy dashboard, deprecate the old one |
| `OPERATOR_PRIVATE_KEY` (Arbitrum) | Generate a new wallet, transfer remaining gas/ETH to the new wallet, update treasury |
| `ACCESS_CODE_ADMIN_SECRET` | `openssl rand -hex 32`, update in production env |
| Anvil key | Keep (public dev key, OK) |

### 3. Scrub Git history

```bash
# Use git-filter-repo (safer than filter-branch)
brew install git-filter-repo
git filter-repo --path .env --invert-paths
git push origin --force --all   # ⚠️ coordinate with the team — this rewrites history
```

### 4. Add a `.env.example` template

Create `.env.example` with placeholder values and commit that instead:

```bash
# .env.example
PRIVY_APP_ID=your_privy_app_id
PRIVY_PROJECT_SECRET=your_privy_secret
OPERATOR_PRIVATE_KEY=0x...
ACCESS_CODE_ADMIN_SECRET=$(openssl rand -hex 32)
```

### 5. Pre-commit hook to prevent future leaks

`.husky/pre-commit`:
```bash
#!/bin/sh
docker run --rm -v "$PWD:/path" zricethezav/gitleaks:latest \
  protect --source=/path --staged
```

Or use the `pre-commit` framework with the `gitleaks` hook.

### 6. Production secrets management

- Use a vault / secrets manager (AWS Secrets Manager, GCP Secret Manager, HashiCorp Vault, Doppler).
- Container deploy: secrets injected via env at boot, never baked into the image.
- `OPERATOR_PRIVATE_KEY` should ideally use an HSM/KMS (e.g. AWS KMS sign), not a plaintext env var.

## Verification

After remediation:

```bash
docker run --rm -v $PWD:/path zricethezav/gitleaks:latest detect --source=/path
# Expected: 0 leaks
```

## References

- [OWASP A02:2021 — Cryptographic Failures](https://owasp.org/Top10/A02_2021-Cryptographic_Failures/)
- [GitGuardian: Removing sensitive data](https://blog.gitguardian.com/rewriting-git-history-cheatsheet/)
- [Anchore: Secrets management best practices](https://anchore.com/blog/secrets-management-best-practices/)
