import {
    Injectable,
    CanActivate,
    ExecutionContext,
    UnauthorizedException,
    Logger,
} from "@nestjs/common";
import { PortfolioAuthStrategyFactory } from "./auth-strategy.factory";

@Injectable()
export class PortfolioAuthGuard implements CanActivate {
    private readonly logger = new Logger(PortfolioAuthGuard.name);

    constructor(
        private readonly strategyFactory: PortfolioAuthStrategyFactory,
    ) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        this.logger.debug(`[PortfolioAuthGuard] intercepting ${request.method} ${request.url}`);
        this.logger.debug(`[PortfolioAuthGuard] headers: ${JSON.stringify(request.headers)}`);

        const authHeader = request.headers.authorization;

        if (!authHeader) {
            throw new UnauthorizedException("Authorization header required");
        }

        const [type, token] = authHeader.split(" ");

        if (type.toLowerCase() !== "bearer" || !token) {
            throw new UnauthorizedException("Invalid authorization format");
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
