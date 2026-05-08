# F-33: Compiled `dist/` build artifacts are committed to the repo

**Severity**: 🟡 Moderate (security adjacent + supply chain)
**OWASP**: A05 Security Misconfiguration, A08 Software & Data Integrity
**CWE**: CWE-540 (Inclusion of Sensitive Information in Source Code), CWE-1395 (Dependency on Vulnerable Third-Party Component)

## Summary

The `dist/` directory contains compiled JavaScript output from the TypeScript build and is **tracked in Git** even though `/dist` is listed in `.gitignore`. The ignore directive doesn't apply retroactively, so the compiled tree was committed at some point and remains version-controlled today (~4 MB across `dist/abis/`, `dist/core/`, `dist/src/`).

Three coupled risks follow:

1. **Drift between source and compiled output**: a developer can forget to rebuild, and committed `dist/` lags `src/`. A reviewer reads the source and assumes it matches the deployed binary; CI may build from `src/` while a Docker image bakes `dist/` from the repo. The two diverge.
2. **Embedded secrets**: gitleaks already finds tokens like `0xOperatorPrivateKey` (a placeholder, but real-shaped) and copies of test fixtures inside `dist/`. Any future PR that compiles with a real value present in source briefly will leave that value in `dist/` even after the source is scrubbed.
3. **Supply-chain footprint**: a malicious actor with PR-merge or push access can edit `dist/*.js` directly without the corresponding source change. Reviewers checking only `src/` won't see it. If the production deploy uses `dist/` from the repo (rather than rebuilding from source in CI), the manipulated file ships.

## Evidence

`.gitignore`:

```
# compiled output
/dist
```

But:

```bash
$ git ls-tree HEAD --name-only | grep '^dist'
dist/abis/...
dist/core/...
dist/src/...
```

Tracked tree:

```bash
$ du -sh dist
4.0M  dist
```

Gitleaks results from F-1's scan included entries inside `dist/`:

```
dist/src/__test__/faucet/faucet.service.test.js   line 32   secret: 0xOperatorPrivateKey
dist/src/__test__/helpers/mock-factories.js       line 16   secret: 0x1234567890abcdef...
dist/src/__test__/orders/orders.service.test.js   line 65   secret: 0xabcdef1234567890...
```

These are placeholders / test fixtures, but the pattern is the same that would catch real secrets if they ever transit through source.

## Impact

- **F-33.1 — Reviewer blind spot**: `src/` and `dist/` are out of sync today (the repo was cloned and not rebuilt; tests show `0xOperatorPrivateKey` in the compiled mock that no longer matches its source). A reviewer reading source can't tell what's actually shipping.
- **F-33.2 — Push-only attacker plants in `dist/`**: an attacker with write access (compromised dev laptop, leaked PAT) edits a single function in `dist/orders/orders.service.js` to bypass an auth check. Reviewers see only the `src/` diff in PRs (or no PR at all on a force-push). CI that doesn't enforce a clean rebuild lets it through.
- **F-33.3 — Stale credential exposure**: any secret accidentally compiled into `dist/` (e.g. via `process.env.X` getting inlined by an aggressive bundler in some toolchain version) lives in Git history forever, even after `src/` is fixed.
- **F-33.4 — PR diff noise**: every source change produces a corresponding `dist/` diff. Real changes are buried under hundreds of lines of regenerated boilerplate. Code review fatigue makes security regressions easier to slip past.
- **F-33.5 — Repo bloat**: 4 MB today; grows linearly with every build.

## Recommended Solution

### 1. Untrack `dist/` and rely on `.gitignore`

```bash
git rm -r --cached dist/
git commit -m "chore: stop tracking dist/ build output"
```

Existing `.gitignore` entry `/dist` then prevents re-add. Verify:

```bash
git status
echo "test" > dist/x.txt && git status   # dist/x.txt should not appear
```

### 2. Scrub `dist/` from history (optional but recommended)

If the goal is to remove the historical 4 MB and any secrets that ever passed through compiled output:

```bash
# Coordinated with the team — this rewrites history.
brew install git-filter-repo
git filter-repo --path dist --invert-paths
git push origin --force --all
```

Pair this with the F-1 history scrub so both operations happen together (one disruption, not two).

### 3. CI builds from source, never from committed `dist/`

Ensure the production Docker image (or whatever artifact builder you use) ignores any `dist/` in the workspace and runs `pnpm run build` itself:

```dockerfile
# Dockerfile (illustrative)
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN rm -rf dist && pnpm run build       # ⬅️ blow away any tracked dist/, then build

FROM node:22-alpine AS run
WORKDIR /app
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/dist /app/dist
CMD ["node", "dist/src/main.js"]
```

The `rm -rf dist && pnpm run build` line guarantees that even if someone slips a manipulated `dist/` past code review (per F-33.2), it never reaches the deployed image.

### 4. Pre-commit hook to refuse `dist/` changes

```bash
# .husky/pre-commit
if git diff --cached --name-only | grep -q '^dist/'; then
    echo "Refusing to commit changes inside dist/ (build output is gitignored)."
    echo "If you want to commit despite this, use: git commit --no-verify"
    exit 1
fi
```

Combined with the F-1 gitleaks pre-commit, the CI gate covers both secrets and accidentally-committed build output.

### 5. CI guard against drift

Run a "no-tracked-build-artifacts" check in CI:

```yaml
# .github/workflows/ci.yml
- name: dist/ must not be tracked
  run: |
      if git ls-files dist/ | head -1 | grep -q .; then
          echo "::error::dist/ contents are tracked; run 'git rm -r --cached dist/' and commit"
          exit 1
      fi
```

### 6. While at it: also untrack `tsconfig.build.tsbuildinfo`

The build incremental cache file `dist/tsconfig.build.tsbuildinfo` is also tracked and changes every build. Ensure it's covered by the same cleanup.

## Verification

```bash
# 1. dist no longer tracked
git ls-files dist/ | wc -l
# Expected: 0

# 2. .gitignore still honors /dist
echo "test" > dist/x.txt && git status --porcelain | grep -q '^?? dist/x.txt' || echo "fail: dist not ignored"

# 3. CI rebuild produces matching dist
pnpm run build
git status --porcelain | grep -E "^.. dist/" && echo "fail: build produced tracked changes"

# 4. Pre-commit rejects dist edits
echo "console.log('x')" >> dist/src/main.js
git add dist/src/main.js
git commit -m "test"
# Expected: hook refuses with the message.
```

## References

- [git rm --cached docs](https://git-scm.com/docs/git-rm)
- [git-filter-repo](https://github.com/newren/git-filter-repo) — modern history rewriter
- [12-Factor App: Build, release, run](https://12factor.net/build-release-run) — separate build from run; build output isn't source
- [OWASP A08:2021 — Software and Data Integrity Failures](https://owasp.org/Top10/A08_2021-Software_and_Data_Integrity_Failures/)
