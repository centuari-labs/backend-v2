import {
    Injectable,
    CanActivate,
    ExecutionContext,
    Logger,
    UnauthorizedException,
} from "@nestjs/common";
import { AuthStrategyFactory } from "./strategies/auth-strategy.factory";

@Injectable()
export class AuthGuard implements CanActivate {
    private readonly logger = new Logger(AuthGuard.name);

    constructor(private readonly strategyFactory: AuthStrategyFactory) {}

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
            const strategy = this.strategyFactory.getStrategy(token);
            request.user = await strategy.validate(token);
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
