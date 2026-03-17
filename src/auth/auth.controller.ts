import { Body, Controller, Patch, Post, UseGuards } from "@nestjs/common";
import { AuthService } from "./auth.service";
import type {
    DepositWalletResponse,
    ValidateWalletDto,
} from "./dto/validate-wallet.dto";
import type { UpdateNameDto } from "./dto/update-name.dto";
import { AuthGuard } from "../common/guards/auth.guard";
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

    @Patch("name")
    @UseGuards(AuthGuard)
    async updateName(
        @CurrentUser() user: AuthUser,
        @Body() body: UpdateNameDto,
    ) {
        return this.authService.updateName(user.userId, body.name);
    }
}
