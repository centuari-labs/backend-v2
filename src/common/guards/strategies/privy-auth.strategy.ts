import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { PrivyService } from "../../../core/privy/privy.service";
import type {
    AuthPrincipal,
    AuthUser,
    IAuthStrategy,
} from "./auth-strategy.interface";

@Injectable()
export class PrivyAuthStrategy implements IAuthStrategy {
    // Cheap bound before any crypto: verifyPrincipal runs on EVERY request
    // (throttler tracker), so non-JWT or oversized input must fail without
    // touching the verifier.
    private static readonly JWT_PATTERN =
        /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
    private static readonly MAX_TOKEN_LENGTH = 4096;

    private readonly logger = new Logger(PrivyAuthStrategy.name);

    constructor(private readonly privyService: PrivyService) {}

    async verifyPrincipal(token: string): Promise<AuthPrincipal> {
        if (
            token.length > PrivyAuthStrategy.MAX_TOKEN_LENGTH ||
            !PrivyAuthStrategy.JWT_PATTERN.test(token)
        ) {
            throw new UnauthorizedException("Invalid token format");
        }

        const result = await this.privyService.verify(token);

        if (!result || !result.userId) {
            throw new UnauthorizedException("Invalid Privy token");
        }

        return { userId: result.userId };
    }

    async resolveAuthUser(
        _token: string,
        principal: AuthPrincipal,
    ): Promise<AuthUser> {
        const walletAddress = await this.extractWalletAddress(principal.userId);

        return {
            userId: principal.userId,
            walletAddress,
        };
    }

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
            const walletAccounts = user.linkedAccounts.filter(
                (account: any) => account.type === "wallet",
            );

            // Prefer external wallet over Privy embedded wallet
            const externalWallet = walletAccounts.find(
                (w: any) => w.walletClientType !== "privy",
            );
            const embeddedWallet = walletAccounts.find(
                (w: any) => w.walletClientType === "privy",
            );
            const wallet = externalWallet ?? embeddedWallet;

            if (wallet && (wallet as any).address) {
                return (wallet as any).address;
            }

            // Fail closed: a verified Privy user with no linked wallet is not a
            // valid actor for any wallet-scoped route. Never fall back to the
            // Privy userId (DID) — that would let a walletless identity be
            // treated as if it owned an address equal to its DID.
            throw new UnauthorizedException(
                "No wallet linked to the authenticated account",
            );
        } catch (error) {
            if (error instanceof UnauthorizedException) {
                throw error;
            }
            this.logger.error(
                `Failed to extract wallet address: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
            // Fail closed on any lookup error rather than returning the DID.
            throw new UnauthorizedException("Unable to resolve wallet address");
        }
    }
}
