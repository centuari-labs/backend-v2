import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Wallet } from "../common/decorators/wallet.decorator";
import { AuthGuard } from "../common/guards/auth.guard";
import { WithdrawService } from "./withdraw.service";
import {
    WithdrawRequestDto,
    type WithdrawResponseDto,
} from "./dto/withdraw.dto";

@Controller("withdraw")
export class WithdrawController {
    constructor(private readonly withdrawService: WithdrawService) {}

    // Withdraw triggers an on-chain payout — tightly rate-limit per IP.
    @Throttle({
        short: { ttl: 1000, limit: 1 },
        long: { ttl: 60000, limit: 5 },
    })
    @Post()
    @UseGuards(AuthGuard)
    async withdraw(
        @Body() dto: WithdrawRequestDto,
        @Wallet() walletAddress: string,
    ): Promise<WithdrawResponseDto> {
        return this.withdrawService.withdraw(dto, walletAddress);
    }
}
