import { Controller, Post, Body, Get, Param, ParseIntPipe, UsePipes, ValidationPipe, UseGuards, UnauthorizedException } from "@nestjs/common";
import { FaucetService } from "./faucet.service";
import { RequestTokenDto, FaucetResponseDto } from "./dto/faucet.dto";
import { AuthGuard } from "../common/guards/auth.guard";
import { Wallet } from "../common/decorators/wallet.decorator";

@Controller("faucet")
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class FaucetController {
    constructor(private readonly faucetService: FaucetService) { }

    @Post("request-tokens")
    @UseGuards(AuthGuard)
    async requestTokens(
        @Body() dto: RequestTokenDto,
        @Wallet() walletAddress: string,
    ): Promise<FaucetResponseDto> {
        if (dto.recipientAddress.toLowerCase() !== walletAddress.toLowerCase()) {
            throw new UnauthorizedException("Recipient address must match authenticated wallet");
        }
        return this.faucetService.requestTokens(dto.chainId, dto.recipientAddress, dto.token);
    }

    @Get("all-tokens/:chainId")
    async getTokens(@Param("chainId", ParseIntPipe) chainId: number): Promise<string[]> {
        return this.faucetService.getTokens(chainId);
    }
}