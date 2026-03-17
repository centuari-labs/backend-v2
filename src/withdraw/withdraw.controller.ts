import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { Wallet } from "../common/decorators/wallet.decorator";
import { AuthGuard } from "../common/guards/auth.guard";
import { WithdrawService } from "./withdraw.service";
import type {
    WithdrawRequestDto,
    WithdrawResponseDto,
} from "./dto/withdraw.dto";

@Controller("withdraw")
export class WithdrawController {
    constructor(private readonly withdrawService: WithdrawService) {}

    @Post()
    @UseGuards(AuthGuard)
    async withdraw(
        @Body() dto: WithdrawRequestDto,
        @Wallet() walletAddress: string,
    ): Promise<WithdrawResponseDto> {
        return this.withdrawService.withdraw(dto, walletAddress);
    }
}
