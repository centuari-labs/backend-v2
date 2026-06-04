import {
    Controller,
    Post,
    Body,
    Get,
    Param,
    ParseIntPipe,
    UseGuards,
    ForbiddenException,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { FaucetService } from "./faucet.service";
import { RequestTokenDto, FaucetResponseDto } from "./dto/faucet.dto";
import { AuthGuard } from "../common/guards/auth.guard";
import { Wallet } from "../common/decorators/wallet.decorator";

@Controller("faucet")
export class FaucetController {
    constructor(private readonly faucetService: FaucetService) {}

    // Faucet drips real testnet tokens on-chain — tightly rate-limit per IP.
    @Throttle({
        short: { ttl: 1000, limit: 1 },
        long: { ttl: 60000, limit: 5 },
    })
    @Post("request-tokens")
    @UseGuards(AuthGuard)
    async requestTokens(
        @Wallet() walletAddress: string,
        @Body() dto: RequestTokenDto,
    ): Promise<FaucetResponseDto> {
        if (
            dto.recipientAddress.toLowerCase() !== walletAddress.toLowerCase()
        ) {
            throw new ForbiddenException(
                "recipientAddress must match the authenticated wallet",
            );
        }
        return this.faucetService.requestTokens(
            dto.chainId,
            dto.recipientAddress,
            dto.token,
        );
    }

    @Get("all-tokens/:chainId")
    async getTokens(
        @Param("chainId", ParseIntPipe) chainId: number,
    ): Promise<string[]> {
        return this.faucetService.getTokens(chainId);
    }
}
