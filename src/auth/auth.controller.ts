import {
    Body,
    Controller,
    Get,
    Param,
    Patch,
    Post,
    UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { AuthService } from "./auth.service";
import type { UpdateNameDto } from "./dto/update-name.dto";
import { RedeemAccessCodeDto } from "./dto/redeem-access-code.dto";
import { GenerateAccessCodesDto } from "./dto/generate-access-codes.dto";
import { AuthGuard } from "../common/guards/auth.guard";
import { AdminSecretGuard } from "../common/guards/admin-secret.guard";
import { CurrentUser } from "../common/decorators/wallet.decorator";
import type { AuthUser } from "../common/guards/strategies/auth-strategy.interface";

@Controller("auth")
export class AuthController {
    constructor(private readonly authService: AuthService) {}

    // Login verifies a bearer token and upserts an account — rate-limit per IP
    // to blunt token-spray / account-enumeration attempts.
    @Throttle({
        short: { ttl: 1000, limit: 3 },
        long: { ttl: 60000, limit: 20 },
    })
    @Post("login")
    @UseGuards(AuthGuard)
    async login(@CurrentUser() user: AuthUser) {
        return this.authService.loginOrCreateAccount(
            user.userId,
            user.walletAddress,
        );
    }

    @Post("redeem-access-code")
    @UseGuards(AuthGuard)
    async redeemAccessCode(
        @CurrentUser() user: AuthUser,
        @Body() body: RedeemAccessCodeDto,
    ) {
        return this.authService.redeemAccessCode(user.userId, body.code);
    }

    @Patch("name")
    @UseGuards(AuthGuard)
    async updateName(
        @CurrentUser() user: AuthUser,
        @Body() body: UpdateNameDto,
    ) {
        return this.authService.updateName(user.userId, body.name);
    }

    // ── Admin endpoints (secret-token protected) ──────────────────
    // Tightly rate-limit per IP to slow brute-forcing of the admin secret.

    @Throttle({
        short: { ttl: 1000, limit: 1 },
        long: { ttl: 60000, limit: 10 },
    })
    @Post("access-codes/generate")
    @UseGuards(AdminSecretGuard)
    async generateAccessCodes(@Body() body: GenerateAccessCodesDto) {
        return this.authService.generateAccessCodes(body);
    }

    @Throttle({
        short: { ttl: 1000, limit: 1 },
        long: { ttl: 60000, limit: 10 },
    })
    @Get("access-codes")
    @UseGuards(AdminSecretGuard)
    async listAccessCodes() {
        return this.authService.listAccessCodes();
    }

    @Throttle({
        short: { ttl: 1000, limit: 1 },
        long: { ttl: 60000, limit: 10 },
    })
    @Patch("access-codes/:id/deactivate")
    @UseGuards(AdminSecretGuard)
    async deactivateAccessCode(@Param("id") id: string) {
        return this.authService.deactivateAccessCode(id);
    }
}
