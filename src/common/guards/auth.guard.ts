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
        // The wallet address can be extracted from Privy user data
        // This is a simplified implementation - in production you might need to
        // fetch the full user profile from Privy to get linked wallet addresses
        // Privy userIds are typically in format: did:privy:xxxxx
        return privyResult.userId; // Placeholder - should be actual wallet
    }
}
