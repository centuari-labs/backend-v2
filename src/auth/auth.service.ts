import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../core/database/database.service";
import { ViemService } from "../core/viem/viem.service";
import type { DepositWalletResponse } from "./dto/validate-wallet.dto";

@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name);

    constructor(
        private readonly databaseService: DatabaseService,
        private readonly viemService: ViemService,
    ) {}

    async validateAndCreateDepositWallet(
        walletAddress: string,
    ): Promise<DepositWalletResponse> {
        // Validate the wallet address
        if (!this.viemService.isValidAddress(walletAddress)) {
            throw new BadRequestException("Invalid wallet address format");
        }

        // Generate a new paired wallet
        const pairedWallet = this.viemService.generateWallet();

        // Insert into database
        const depositWallet =
            await this.databaseService.insert<DepositWalletResponse>(
                "deposit_wallets",
                {
                    wallet_address: walletAddress,
                    paired_wallet_address: pairedWallet.address,
                    paired_wallet_primary_key: pairedWallet.privateKey,
                },
            );

        this.logger.log(
            `Created deposit wallet for ${walletAddress} with paired address ${pairedWallet.address}`,
        );

        return depositWallet;
    }

    async loginOrCreateAccount(privyUserId: string, walletAddress: string) {
        const account = await this.databaseService.queryOne(
            `INSERT INTO accounts (privy_user_id, user_wallet)
             VALUES ($1, $2)
             ON CONFLICT (privy_user_id) DO UPDATE SET user_wallet = EXCLUDED.user_wallet
             RETURNING *`,
            [privyUserId, walletAddress],
        );

        this.logger.log(
            `Account upserted for privy user ${privyUserId} with wallet ${walletAddress}`,
        );

        return account;
    }
}
