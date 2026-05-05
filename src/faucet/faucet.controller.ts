import {
    Controller,
    Post,
    Body,
    Get,
    Param,
    ParseIntPipe,
} from "@nestjs/common";
import { FaucetService } from "./faucet.service";
import { RequestTokenDto, FaucetResponseDto } from "./dto/faucet.dto";

@Controller("faucet")
export class FaucetController {
    constructor(private readonly faucetService: FaucetService) {}

    @Post("request-tokens")
    async requestTokens(
        @Body() dto: RequestTokenDto,
    ): Promise<FaucetResponseDto> {
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
