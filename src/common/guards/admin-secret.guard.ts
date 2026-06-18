import { createHash, timingSafeEqual } from "node:crypto";
import {
    CanActivate,
    ExecutionContext,
    Injectable,
    UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class AdminSecretGuard implements CanActivate {
    constructor(private readonly configService: ConfigService) {}

    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest();
        const authHeader = request.headers.authorization;

        if (!authHeader?.startsWith("Bearer ")) {
            throw new UnauthorizedException("Missing admin secret");
        }

        const token = authHeader.slice(7);
        const secret = this.configService.get<string>(
            "ACCESS_CODE_ADMIN_SECRET",
        );

        // Fail closed when the secret is unset/empty.
        if (!secret) {
            throw new UnauthorizedException("Invalid admin secret");
        }

        if (!this.constantTimeEquals(token, secret)) {
            throw new UnauthorizedException("Invalid admin secret");
        }

        return true;
    }

    /**
     * Constant-time string comparison. The two values are hashed to equal-length
     * buffers first so `timingSafeEqual` never throws on a length mismatch and
     * the comparison itself leaks no timing signal about the secret's length or
     * content.
     */
    private constantTimeEquals(a: string, b: string): boolean {
        const aHash = createHash("sha256").update(a).digest();
        const bHash = createHash("sha256").update(b).digest();
        return timingSafeEqual(aHash, bHash);
    }
}
