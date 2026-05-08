# F-12: `body-parser` DoS on urlencoded

**Severity**: 🟡 Moderate
**OWASP**: A06 Vulnerable Components
**CVE/GHSA**: GHSA-wqch-xfxh-vrr4

## Summary

`body-parser@2.2.0` (transitive via Express) is vulnerable to DoS when parsing urlencoded bodies with deeply nested or malformed input.

## Evidence

```
moderate  body-parser is vulnerable to denial of service when url encoding is used
Path: .>@nestjs/platform-express>express>body-parser
```

## Impact

- Partially mitigated by the 10kb body limit in `main.ts` (`app.use(urlencoded({ limit: "10kb" }))`).
- Still worth updating because a 10kb urlencoded payload can still trigger CPU spikes.

## Recommended Solution

### 1. Update transitive

```bash
pnpm update express @nestjs/platform-express
pnpm audit | grep body-parser
```

`package.json` override:
```json
{
  "pnpm": {
    "overrides": {
      "body-parser": "^2.2.1",
      "qs": "^6.14.2"
    }
  }
}
```

### 2. Restrict urlencoded usage

The codebase API is JSON only — consider disabling urlencoded entirely:

`main.ts`:
```diff
  app.use(json({ limit: "10kb" }));
- app.use(urlencoded({ limit: "10kb", extended: true }));
+ // urlencoded disabled — API is JSON only
```

No endpoint requires form-encoded bodies in this REST API.

### 3. Tighten parameter limits

If urlencoded must remain enabled:

```typescript
app.use(urlencoded({
    limit: "10kb",
    extended: false,        // ⚠️ "qs" lib with extended=true has CVE history
    parameterLimit: 100,    // limit total params per request
}));
```

## Verification

```bash
pnpm audit | grep -E "body-parser|qs"
# Expected: empty (or only low-severity)
```

## References

- [GHSA-wqch-xfxh-vrr4](https://github.com/advisories/GHSA-wqch-xfxh-vrr4)
