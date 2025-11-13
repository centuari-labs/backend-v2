import { Body, Controller, Post } from "@nestjs/common";
import { AuthService } from "./auth.service";
import type {
    DepositWalletResponse,
    ValidateWalletDto,
} from "./dto/validate-wallet.dto";

@Controller("auth")
export class AuthController {
    constructor(private readonly authService: AuthService) {}

    @Post("validate")
    async validate(@Body() body: ValidateWalletDto): Promise<DepositWalletResponse> {
        return this.authService.validateAndCreateDepositWallet(body.wallet_address);
    }
}
