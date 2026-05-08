# F-3: handlebars 4.7.8 — JS injection via AST type confusion

**Severity**: 🟠 High (build-time only)
**OWASP**: A06 Vulnerable and Outdated Components
**CVE/GHSA**: GHSA-2w6w-674q-4c4q (Critical), GHSA-3mfm-83xf-c92r, GHSA-xhpv-hc6g-r9c6, GHSA-9cx6-37pm-9jff, GHSA-xjpj-3mr7-gcpf, GHSA-442j-39wm-28r2

## Summary

The transitive dependency `handlebars@4.7.8` (via `ts-jest`) is affected by 6 CVEs, including one Critical JS injection via AST type confusion. While handlebars is only used at test time (ts-jest), there is still risk if the test environment is exposed to untrusted templates or the CI runner is compromised.

## Evidence

```bash
$ pnpm audit --json | jq -r '.advisories | to_entries[] |
    .value | select(.module_name == "handlebars") |
    "\(.severity)\t\(.title)\t\(.url)"'

critical  Handlebars.js has JavaScript Injection via AST Type Confusion
high      Handlebars.js has Denial of Service via Malformed Decorator Syntax
high      Handlebars.js has JavaScript Injection in CLI Precompiler
high      Handlebars.js has JavaScript Injection via AST Type Confusion (partial-block)
high      Handlebars.js has JavaScript Injection via AST Type Confusion (dynamic partial)
low       Handlebars.js has a Property Access Validation Bypass

Path: .>ts-jest>handlebars
```

## Impact

- **F-3.1**: if an attacker can inject a template into a ts-jest snapshot or test fixture, RCE during a test run is possible.
- **F-3.2**: CI/CD environments where tests run with elevated permissions amplify the blast radius.
- **F-3.3**: Lower priority because it isn't on the runtime production path.

## Recommended Solution

### Option A: Update transitive (preferred)

```bash
pnpm update --latest ts-jest
# Or pin override in package.json
```

Add a `package.json` override to force the handlebars version:

```json
{
  "pnpm": {
    "overrides": {
      "handlebars": "^4.7.9"
    }
  }
}
```

Then:
```bash
pnpm install
pnpm audit | grep handlebars  # should be empty
```

### Option B: Replace ts-jest

If ts-jest isn't strictly required, switch to `@swc/jest` (faster + no handlebars dep):

```bash
pnpm remove ts-jest
pnpm add -D @swc/jest @swc/core
```

`jest.config.js`:
```diff
  transform: {
-   "^.+\\.tsx?$": "ts-jest",
+   "^.+\\.tsx?$": ["@swc/jest", { /* swc options */ }],
  }
```

## Verification

```bash
pnpm audit --json | jq '.advisories | to_entries[] | .value | select(.module_name == "handlebars")'
# Expected: empty
```

## References

- [GHSA-2w6w-674q-4c4q (Critical)](https://github.com/advisories/GHSA-2w6w-674q-4c4q)
