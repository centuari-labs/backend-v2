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

        const walletAddress = await this.extractWalletAddress(result.userId);

        return {
            userId: result.userId,
            walletAddress,
        };
    }

    getName(): string {
        return "privy";
    }

    private async extractWalletAddress(userId: string): Promise<string> {
        try {
            const user = await this.privyService.getUser(userId);
            const walletAccount = user.linkedAccounts.find(
                (account: any) => account.type === 'wallet'
            );

            if (walletAccount && (walletAccount as any).address) {
                return (walletAccount as any).address;
            }

            return userId;
        } catch (error) {
            console.error("Failed to extract wallet address:", error);
            return userId;
        }
    }
}
