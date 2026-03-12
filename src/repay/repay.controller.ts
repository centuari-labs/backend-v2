import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { Wallet } from "../common/decorators/wallet.decorator";
import { AuthGuard } from "../common/guards/auth.guard";
import { RepayService } from "./repay.service";
import type { RepayRequestDto, RepayResponseDto } from "./dto/repay.dto";

@Controller("repay")
export class RepayController {
    constructor(private readonly repayService: RepayService) { }

    @Post()
    @UseGuards(AuthGuard)
    async repay(
        @Body() dto: RepayRequestDto,
    ): Promise<RepayResponseDto> {
        return this.repayService.repay(dto);
    }
}
