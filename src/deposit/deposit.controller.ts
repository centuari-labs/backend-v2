import {
    Controller,
    Get,
    Param,
    ParseUUIDPipe,
    UseGuards,
} from "@nestjs/common";
import { Wallet } from "../common/decorators/wallet.decorator";
import { AuthGuard } from "../common/guards/auth.guard";
import { DepositService } from "./deposit.service";
import type { DepositTokenDto, BalanceResponseDto } from "./dto/deposit.dto";

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
}
