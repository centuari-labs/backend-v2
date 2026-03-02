import {
    Body,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    ParseUUIDPipe,
    Post,
    UseGuards,
} from "@nestjs/common";
import { Wallet } from "../common/decorators/wallet.decorator";
import { BearerToken } from "../common/decorators/bearer-token.decorator";
import { AuthGuard } from "../common/guards/auth.guard";
import { DepositService } from "./deposit.service";
import { CreateDepositDto, VerifyDepositDto } from "./dto/deposit.dto";
import type {
    DepositResponseDto,
    DepositTokenDto,
    BalanceResponseDto,
} from "./dto/deposit.dto";

@Controller("deposit")
export class DepositController {
    constructor(private readonly depositService: DepositService) {}

    @Post()
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard)
    async deposit(
        @Body() dto: CreateDepositDto,
        @Wallet() walletAddress: string,
        @BearerToken() bearerToken: string,
    ): Promise<DepositResponseDto> {
        return this.depositService.deposit(
            dto.assetId,
            dto.amount,
            walletAddress,
            bearerToken,
        );
    }

    @Post("verify")
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard)
    async verifyDeposit(
        @Body() dto: VerifyDepositDto,
        @Wallet() walletAddress: string,
    ): Promise<DepositResponseDto> {
        return this.depositService.verifyDeposit(
            dto.txHash,
            dto.assetId,
            dto.amount,
            walletAddress,
        );
    }

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
