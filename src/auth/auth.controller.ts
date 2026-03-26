import {
    Body,
    Controller,
    Get,
    Param,
    Patch,
    Post,
    UseGuards,
    UsePipes,
    ValidationPipe,
} from "@nestjs/common";
import { AuthService } from "./auth.service";
import type {
    DepositWalletResponse,
    ValidateWalletDto,
} from "./dto/validate-wallet.dto";
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

    @Post("validate")
    async validate(
        @Body() body: ValidateWalletDto,
    ): Promise<DepositWalletResponse> {
        return this.authService.validateAndCreateDepositWallet(
            body.wallet_address,
        );
    }

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
    @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
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

    @Post("access-codes/generate")
    @UseGuards(AdminSecretGuard)
    @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
    async generateAccessCodes(@Body() body: GenerateAccessCodesDto) {
        return this.authService.generateAccessCodes(body);
    }

    @Get("access-codes")
    @UseGuards(AdminSecretGuard)
    async listAccessCodes() {
        return this.authService.listAccessCodes();
    }

    @Patch("access-codes/:id/deactivate")
    @UseGuards(AdminSecretGuard)
    async deactivateAccessCode(@Param("id") id: string) {
        return this.authService.deactivateAccessCode(id);
    }
}
