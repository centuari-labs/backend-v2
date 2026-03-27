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

        if (!secret || token !== secret) {
            throw new UnauthorizedException("Invalid admin secret");
        }

        return true;
    }
}
