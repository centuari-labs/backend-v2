import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { PrivyService } from "../../core/privy/privy.service";

/**
 * Guard that validates Privy JWT token from Authorization header
 * and attaches the user's wallet address to the request
 */
@Injectable()
export class AuthGuard implements CanActivate {
    constructor(private readonly privyService: PrivyService) {}

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
            const result = await this.privyService.verify(token);
            
            // Extract wallet address from Privy user
            // Privy stores the wallet in linkedAccounts or similar
            request.user = {
                userId: result.userId,
                walletAddress: await this.extractWalletAddress(result),
            };

            return true;
        } catch (error) {
            throw new UnauthorizedException("Invalid or expired token");
        }
    }

    private async extractWalletAddress(privyResult: { userId: string }): Promise<string> {
        try {
            const user = await this.privyService.getUser(privyResult.userId);
            // Find the first linked account that is a wallet
            // @ts-ignore - linkedAccounts types might be complex
            const walletAccount = user.linkedAccounts.find(
                (account: any) => account.type === 'wallet'
            );

            if (walletAccount && (walletAccount as any).address) {
                return (walletAccount as any).address;
            }
            
            // Fallback to userId if no wallet found (shouldn't happen for valid users)
            return privyResult.userId;
        } catch (error) {
            console.error("Failed to extract wallet address:", error);
            return privyResult.userId;
        }
    }
}
