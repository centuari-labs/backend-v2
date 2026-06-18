import {
    Body,
    Controller,
    Get,
    Param,
    ParseUUIDPipe,
    Post,
    UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Wallet } from "../common/decorators/wallet.decorator";
import { AuthGuard } from "../common/guards/auth.guard";
import { DepositService } from "./deposit.service";
import { ConfirmDepositDto } from "./dto/deposit.dto";
import type {
    DepositTokenDto,
    BalanceResponseDto,
    ConfirmDepositResponseDto,
} from "./dto/deposit.dto";

@Controller("deposit")
export class DepositController {
    constructor(private readonly depositService: DepositService) {}

    @Get("tokens")
    async getDepositTokens(): Promise<DepositTokenDto[]> {
        return this.depositService.getDepositTokens();
    }

    @Get("balance/:assetId")
    @UseGuards(AuthGuard)
    async getBalance(
        @Param("assetId", ParseUUIDPipe) assetId: string,
        @Wallet() walletAddress: string,
    ): Promise<BalanceResponseDto> {
        return this.depositService.getBalance(assetId, walletAddress);
    }

    // Deposit-confirm replays an on-chain receipt into local state — rate-limit.
    @Throttle({
        short: { ttl: 1000, limit: 2 },
        long: { ttl: 60000, limit: 20 },
    })
    @Post("confirm")
    @UseGuards(AuthGuard)
    async confirmDeposit(
        @Body() dto: ConfirmDepositDto,
        @Wallet() walletAddress: string,
    ): Promise<ConfirmDepositResponseDto> {
        return this.depositService.confirmDeposit(dto.txHash, walletAddress);
    }
}
