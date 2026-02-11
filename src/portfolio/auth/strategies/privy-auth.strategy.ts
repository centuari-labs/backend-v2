import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PrivyService } from "../../../core/privy/privy.service";
import type { AuthUser, IAuthStrategy } from "./auth-strategy.interface";

@Injectable()
export class PrivyAuthStrategy implements IAuthStrategy {
    constructor(private readonly privyService: PrivyService) { }

    async validate(token: string): Promise<AuthUser> {
        const result = await this.privyService.verify(token);

        if (!result || !result.userId) {
            throw new UnauthorizedException("Invalid Privy token");
        }

        return {
            userId: result.userId,
            walletAddress: result.userId,
        };
    }

    getName(): string {
        return "privy";
    }
}
