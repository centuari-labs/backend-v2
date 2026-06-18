import {
    BadRequestException,
    Injectable,
    Logger,
    NotFoundException,
} from "@nestjs/common";
import { randomInt } from "node:crypto";
import { DatabaseService } from "../core/database/database.service";
import type { GenerateAccessCodesDto } from "./dto/generate-access-codes.dto";

@Injectable()
export class AuthService {
    private static readonly ACCESS_CODE_ALPHABET =
        "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private static readonly ACCESS_CODE_RANDOM_LENGTH = 12;

    private readonly logger = new Logger(AuthService.name);

    constructor(private readonly databaseService: DatabaseService) {}

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

    async redeemAccessCode(privyUserId: string, code: string) {
        const accessCode = await this.databaseService.queryOne<{
            id: string;
            max_uses: number;
            current_uses: number;
            expires_at: string | null;
        }>("SELECT * FROM access_codes WHERE code = $1 AND is_active = true", [
            code,
        ]);
        if (!accessCode) {
            throw new BadRequestException("Invalid access code");
        }

        if (
            accessCode.expires_at &&
            new Date(accessCode.expires_at) < new Date()
        ) {
            throw new BadRequestException("Access code has expired");
        }

        if (
            accessCode.max_uses !== -1 &&
            accessCode.current_uses >= accessCode.max_uses
        ) {
            throw new BadRequestException(
                "Access code has reached its usage limit",
            );
        }

        // Idempotent: if user already redeemed any code, just ensure flag is set
        const existing = await this.databaseService.queryOne(
            "SELECT 1 FROM access_code_redemptions WHERE privy_user_id = $1 LIMIT 1",
            [privyUserId],
        );
        if (existing) {
            await this.databaseService.query(
                "UPDATE accounts SET access_granted = true WHERE privy_user_id = $1",
                [privyUserId],
            );
            return { granted: true };
        }

        // Redeem: insert redemption, increment uses, flag account
        await this.databaseService.query(
            "INSERT INTO access_code_redemptions (access_code_id, privy_user_id) VALUES ($1, $2)",
            [accessCode.id, privyUserId],
        );
        await this.databaseService.query(
            "UPDATE access_codes SET current_uses = current_uses + 1 WHERE id = $1",
            [accessCode.id],
        );
        await this.databaseService.query(
            "UPDATE accounts SET access_granted = true WHERE privy_user_id = $1",
            [privyUserId],
        );

        this.logger.log(`Access code redeemed by privy user ${privyUserId}`);

        return { granted: true };
    }

    async generateAccessCodes(opts: GenerateAccessCodesDto) {
        const count = opts.count ?? 1;
        const maxUses = opts.max_uses ?? 1;
        const prefix = opts.prefix ?? "CENTUARI";
        const expiresAt = opts.expires_at ?? null;

        const codes: Array<{
            id: string;
            code: string;
            max_uses: number;
            expires_at: string | null;
        }> = [];

        for (let i = 0; i < count; i++) {
            const code = `${prefix}-${this.generateRandomCode(
                AuthService.ACCESS_CODE_RANDOM_LENGTH,
            )}`;

            const row = await this.databaseService.queryOne<{
                id: string;
                code: string;
                max_uses: number;
                expires_at: string | null;
            }>(
                `INSERT INTO access_codes (code, max_uses, expires_at)
                 VALUES ($1, $2, $3)
                 RETURNING id, code, max_uses, expires_at`,
                [code, maxUses, expiresAt],
            );

            if (row) {
                codes.push(row);
            }
        }

        this.logger.log(
            `Generated ${codes.length} access codes with prefix ${prefix}`,
        );

        return { codes };
    }

    async listAccessCodes() {
        const codes = await this.databaseService.query(
            `SELECT id, code, max_uses, current_uses, is_active, expires_at, created_at
             FROM access_codes
             ORDER BY created_at DESC`,
        );

        return { codes };
    }

    async deactivateAccessCode(id: string) {
        const code = await this.databaseService.queryOne(
            "UPDATE access_codes SET is_active = false WHERE id = $1 RETURNING *",
            [id],
        );

        if (!code) {
            throw new NotFoundException("Access code not found");
        }

        this.logger.log(`Deactivated access code ${id}`);

        return code;
    }

    private generateRandomCode(length: number): string {
        let result = "";
        for (let i = 0; i < length; i++) {
            result +=
                AuthService.ACCESS_CODE_ALPHABET[
                    randomInt(AuthService.ACCESS_CODE_ALPHABET.length)
                ];
        }
        return result;
    }

    async updateName(privyUserId: string, name: string) {
        const account = await this.databaseService.queryOne(
            "UPDATE accounts SET name = $1 WHERE privy_user_id = $2 RETURNING *",
            [name, privyUserId],
        );

        this.logger.log(`Name updated for privy user ${privyUserId}`);

        return account;
    }
}
