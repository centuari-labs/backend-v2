import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { Wallet } from "../common/decorators/wallet.decorator";
import { AuthGuard } from "../common/guards/auth.guard";
import { CollateralService } from "./collateral.service";
import type { CollateralMutationResponse } from "./dto/collateral.dto";
import { FlagCollateralDto, UnflagCollateralDto } from "./dto/collateral.dto";

@Controller("collateral")
export class CollateralController {
    constructor(private readonly collateralService: CollateralService) {}

    @Post("flag")
    @UseGuards(AuthGuard)
    async flag(
        @Wallet() walletAddress: string,
        @Body() dto: FlagCollateralDto,
    ): Promise<CollateralMutationResponse> {
        return this.collateralService.flag(walletAddress, dto);
    }

    @Post("unflag")
    @UseGuards(AuthGuard)
    async unflag(
        @Wallet() walletAddress: string,
        @Body() dto: UnflagCollateralDto,
    ): Promise<CollateralMutationResponse> {
        return this.collateralService.unflag(walletAddress, dto);
    }
}
