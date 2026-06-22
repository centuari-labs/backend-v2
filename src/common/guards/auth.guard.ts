import {
    Injectable,
    CanActivate,
    ExecutionContext,
    Logger,
    UnauthorizedException,
} from "@nestjs/common";
import { RequestAuthService } from "./strategies/request-auth.service";

@Injectable()
export class AuthGuard implements CanActivate {
    private readonly logger = new Logger(AuthGuard.name);

    constructor(private readonly requestAuth: RequestAuthService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const authHeader = request.headers.authorization;

        if (!authHeader) {
            throw new UnauthorizedException("Authorization header is required");
        }

        const [type, token] = authHeader.split(" ");

        if (type !== "Bearer" || !token) {
            throw new UnauthorizedException(
                "Invalid authorization header format",
            );
        }

        try {
            // Shared per-request resolver: if the global throttler already
            // verified this token for its bucket key, the result is memoized
            // and no second verification happens (AuthGuard stays the sole
            // setter of request.user).
            request.user = await this.requestAuth.getAuthUser(request);
            return true;
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            this.logger.warn(`Token validation failed: ${message}`);
            // Keep the response message generic — never leak the cause to the
            // client.
            throw new UnauthorizedException("Invalid or expired token");
        }
    }
}
