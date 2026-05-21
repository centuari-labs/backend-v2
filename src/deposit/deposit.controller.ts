import {
    Body,
    Controller,
    Get,
    Param,
    ParseUUIDPipe,
    Post,
    UseGuards,
} from "@nestjs/common";
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

    @Post("confirm")
    @UseGuards(AuthGuard)
    async confirmDeposit(
        @Body() dto: ConfirmDepositDto,
        @Wallet() walletAddress: string,
    ): Promise<ConfirmDepositResponseDto> {
        return this.depositService.confirmDeposit(dto.txHash, walletAddress);
    }
}
