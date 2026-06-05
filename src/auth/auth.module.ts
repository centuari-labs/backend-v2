import { Module } from "@nestjs/common";
import { CoreModule } from "../core/core.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { WalletThrottlerGuard } from "../common/guards/wallet-throttler.guard";

@Module({
    imports: [CoreModule],
    controllers: [AuthController],
    providers: [AuthService, WalletThrottlerGuard],
    exports: [AuthService],
})
export class AuthModule {}
