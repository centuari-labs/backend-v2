# F-5: multer 2.0.2 — multiple DoS vulnerabilities

**Severity**: 🟠 High (only if upload endpoints exist)
**OWASP**: A06 Vulnerable Components
**CVE/GHSA**: GHSA-5528-5vmv-3xc2, GHSA-xf7r-hgr6-v32p, GHSA-v52c-386h-88mc

## Summary

`multer@2.0.2` has 3 DoS vulnerabilities:
1. Uncontrolled recursion → stack overflow.
2. Incomplete cleanup → temp file leak.
3. Resource exhaustion via specially crafted upload.

`multer` is a dependency of `@nestjs/platform-express` (cannot be removed outright).

## Evidence

```bash
$ pnpm audit --json | jq -r '.advisories | to_entries[] | .value |
    select(.module_name == "multer") | "\(.severity)\t\(.title)"'

high  Multer Vulnerable to Denial of Service via Uncontrolled Recursion
high  Multer vulnerable to Denial of Service via incomplete cleanup
high  Multer vulnerable to Denial of Service via resource exhaustion
```

## Impact

- **F-5.1**: if any upload endpoint exists (`@UseInterceptors(FileInterceptor)`), an attacker can crash the worker with a crafted multipart payload.
- **F-5.2**: a codebase scan found no upload endpoints → low priority. Still update.

```bash
# Audit upload usage
$ grep -rn "FileInterceptor\|FilesInterceptor\|MulterModule\|@UploadedFile" src --include="*.ts"
# (no results found at scan time)
```

## Recommended Solution

### 1. Update via override

`package.json`:
```json
{
  "pnpm": {
    "overrides": {
      "multer": "^2.0.3"
    }
  }
}
```

```bash
pnpm install
pnpm audit | grep multer
```

### 2. If upload is implemented later — guards needed

```typescript
@Post("upload")
@UseInterceptors(FileInterceptor("file", {
    limits: {
        fileSize: 5 * 1024 * 1024,  // 5MB max
        files: 1,
    },
    fileFilter: (req, file, cb) => {
        const allowed = ["image/jpeg", "image/png"];
        cb(allowed.includes(file.mimetype) ? null : new BadRequestException("Invalid type"), allowed.includes(file.mimetype));
    },
}))
async upload(@UploadedFile() file: Express.Multer.File) {
    // Verify magic bytes (don't trust mimetype)
    const isValid = await this.imageVerifier.verify(file.buffer);
    if (!isValid) throw new BadRequestException("Invalid image");
    // ...
}
```

## Verification

```bash
pnpm audit --json | jq '.advisories | to_entries[] | .value | select(.module_name == "multer")'
# Expected: empty
```

## References

- [GHSA-5528-5vmv-3xc2](https://github.com/advisories/GHSA-5528-5vmv-3xc2)
- [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
