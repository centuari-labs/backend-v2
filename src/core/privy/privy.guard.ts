import {
    CanActivate,
    ExecutionContext,
    Injectable,
    UnauthorizedException,
} from "@nestjs/common";
import { PrivyService } from "./privy.service";

@Injectable()
export class PrivyGuard implements CanActivate {
    constructor(private readonly privyAuth: PrivyService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const req = context.switchToHttp().getRequest();

        const auth = req.headers.authorization;
        if (!auth)
            throw new UnauthorizedException("Missing Authorization header");

        const token = auth.replace("Bearer ", "").trim();
        if (!token) throw new UnauthorizedException("Missing token");

        const user = await this.privyAuth.verify(token);

        req.user = user; // inject user ke request
        return true;
    }
}
