import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { AuthStrategyFactory } from "./strategies/auth-strategy.factory";

@Injectable()
export class AuthGuard implements CanActivate {
    constructor(private readonly strategyFactory: AuthStrategyFactory) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const authHeader = request.headers.authorization;

        if (!authHeader) {
            throw new UnauthorizedException("Authorization header is required");
        }

        const [type, token] = authHeader.split(" ");

        if (type !== "Bearer" || !token) {
            throw new UnauthorizedException("Invalid authorization header format");
        }

        try {
            const strategy = this.strategyFactory.getStrategy();
            request.user = await strategy.validate(token);
            return true;
        } catch (error) {
            throw new UnauthorizedException("Invalid or expired token");
        }
    }
}
