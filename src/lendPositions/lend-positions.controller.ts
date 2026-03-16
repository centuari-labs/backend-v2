import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { Wallet, CurrentUser } from "../common/decorators/wallet.decorator";
import { AuthGuard } from "../common/guards/auth.guard";
import { LendPositionsService } from "./lend-positions.service";
import type {
    WithdrawLendPositionDto,
    WithdrawLendPositionResponseDto,
} from "./dto/withdraw-lend-position.dto";

@Controller("lend-positions")
@UseGuards(AuthGuard)
export class LendPositionsController {
    constructor(private readonly lendPositionsService: LendPositionsService) {}

    @Post("withdraw")
    async withdrawLendPosition(
        @Body() dto: WithdrawLendPositionDto,
        @Wallet() walletAddress: string,
        @CurrentUser() user: { userId: string },
    ): Promise<WithdrawLendPositionResponseDto> {
        return this.lendPositionsService.withdrawLendPosition(
            dto,
            walletAddress,
            user.userId,
        );
    }
}
