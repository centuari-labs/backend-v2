# F-14: Error response leaks implementation details

**Severity**: 🟡 Moderate
**OWASP**: A05 Security Misconfiguration
**CWE**: CWE-209 (Information Exposure Through an Error Message)

## Summary

`AllExceptionsFilter` returns stack-style error messages that leak library versions and internal state to the client. This information helps attackers fingerprint the stack for targeted exploits.

## Evidence

```bash
$ curl -s -X POST http://localhost:8080/deposit/confirm \
    -H "Authorization: Bearer DEV_TOKEN_0x1111..." \
    -d '{"txHash":"0x0000000000000000000000000000000000000000000000000000000000000000"}'

{
  "success": false,
  "message": "Internal server error: Transaction receipt with hash \"0x0000...\" could not be found. The Transaction may not be processed on a block yet.\n\nVersion: viem@2.38.6",
  "statusCode": 500
}
```

Leaked info:
- Library: `viem@2.38.6` (pinpoints known CVEs).
- Internal hash format expectations.
- Implementation hint (uses block-based confirmation).

## Impact

- **F-14.1**: an attacker fingerprints the stack → searches for known CVEs in `viem@2.38.6`.
- **F-14.2**: error messages reveal logic flow (e.g. "Transaction may not be processed on a block yet" indicates an RPC-based check).
- **F-14.3**: stack traces (if included) leak file paths and line numbers — useful for targeted exploitation.

## Recommended Solution

### 1. Generic error messages in production

`src/common/filters/http-exception.filter.ts`:

```typescript
import {
    ArgumentsHost,
    Catch,
    ExceptionFilter,
    HttpException,
    HttpStatus,
    Logger,
} from "@nestjs/common";
import { Response } from "express";
import { randomUUID } from "node:crypto";

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
    private readonly logger = new Logger(AllExceptionsFilter.name);
    private readonly isProduction =
        process.env.NODE_ENV === "production";

    catch(exception: unknown, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse<Response>();
        const request = ctx.getRequest();

        const errorId = randomUUID();
        let status = HttpStatus.INTERNAL_SERVER_ERROR;
        let publicMessage: string | object = "Internal server error";

        if (exception instanceof HttpException) {
            status = exception.getStatus();
            const responseBody = exception.getResponse();
            // HttpException = expected, safe to pass through
            publicMessage = typeof responseBody === "string"
                ? responseBody
                : (responseBody as any).message ?? responseBody;
        } else if (this.isProduction) {
            // Unknown exception in prod — generic message + correlation ID
            publicMessage = `Internal server error (ref: ${errorId})`;
        } else {
            // Dev mode — show full error
            publicMessage = (exception as Error)?.message ?? "Unknown error";
        }

        // Always log full details server-side for debugging
        this.logger.error(
            `[${errorId}] ${request.method} ${request.url} → ${status}`,
            exception instanceof Error ? exception.stack : String(exception),
        );

        response.status(status).json({
            success: false,
            message: publicMessage,
            statusCode: status,
            errorId: this.isProduction ? errorId : undefined,
            timestamp: new Date().toISOString(),
            path: request.url,
        });
    }
}
```

### 2. Sanitize known leaky exception types

If viem error messages still leak through `HttpException`, sanitize specifically:

```typescript
private sanitize(message: string): string {
    return message
        .replace(/Version: \w+@[\d.]+/g, "")           // strip version
        .replace(/at .+:\d+:\d+/g, "")                 // strip stack frames
        .replace(/file:\/\/\/.*\.(ts|js)/g, "")        // strip paths
        .trim();
}
```

### 3. Don't log sensitive data

Audit `Logger.log/error/warn` calls for sensitive data:

```bash
grep -rn "Logger\|logger\." src --include="*.ts" | \
    grep -iE "private_key|secret|token|password" | head
```

Mask sensitive fields before logging:
```typescript
private maskWallet(addr: string): string {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}
```

### 4. CORS + security headers

Add helmet (related):

```bash
pnpm add helmet
```

`main.ts`:
```typescript
import helmet from "helmet";
app.use(helmet());  // disables X-Powered-By, sets CSP, etc.
```

## Verification

```bash
# After fix:
curl -X POST http://localhost:8080/deposit/confirm \
  -H "Authorization: Bearer DEV_TOKEN_0x1111..." \
  -d '{"txHash":"0x0000000000000000000000000000000000000000000000000000000000000000"}'

# Expected (production mode):
# {
#   "success": false,
#   "message": "Internal server error (ref: <uuid>)",
#   "statusCode": 500,
#   "errorId": "<uuid>",
#   ...
# }
# No "viem@2.38.6", no stack details

# Logs should still have full info:
docker logs <container> | grep <uuid>
```

## References

- [OWASP A05:2021 — Security Misconfiguration](https://owasp.org/Top10/A05_2021-Security_Misconfiguration/)
- [CWE-209](https://cwe.mitre.org/data/definitions/209.html)
- [Helmet.js](https://helmetjs.github.io/)
