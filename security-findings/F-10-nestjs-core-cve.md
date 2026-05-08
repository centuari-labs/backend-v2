# F-10: `@nestjs/core` injection neutralization

**Severity**: 🟡 Moderate
**OWASP**: A03 Injection, A06 Vulnerable Components
**CVE/GHSA**: GHSA-36xv-jgw5-4q75

## Summary

`@nestjs/core@11.1.8` improperly neutralizes special elements in output used by a downstream component (header injection / response splitting class).

## Evidence

```
Severity: Moderate
Path: @nestjs/core@11.1.8
Patched: latest
```

## Impact

- The exploitation scenario depends heavily on downstream usage. If any code passes untrusted input to a response header without sanitization, header injection / cache poisoning is possible.
- The codebase doesn't appear to manipulate response headers manually, so actual risk is low.

## Recommended Solution

```bash
pnpm update @nestjs/core @nestjs/common @nestjs/platform-express
```

Or pin in `package.json`:
```json
{
  "dependencies": {
    "@nestjs/core": "^11.2.0",
    "@nestjs/common": "^11.2.0"
  }
}
```

## Verification

```bash
pnpm audit | grep "@nestjs/core"
# Expected: empty
```

## References

- [GHSA-36xv-jgw5-4q75](https://github.com/advisories/GHSA-36xv-jgw5-4q75)
