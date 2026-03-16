import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { TransactionHistoryService } from "./transaction-history.service";
import { TransactionHistoryQueryDto } from "./dto/transaction-history.dto";
import { AuthGuard } from "../common/guards/auth.guard";
import { Wallet } from "../common/decorators/wallet.decorator";

@Controller("transaction-history")
@UseGuards(AuthGuard)
export class TransactionHistoryController {
    constructor(
        private readonly transactionHistoryService: TransactionHistoryService,
    ) {}

    @Get()
    async getTransactionHistory(
        @Wallet() wallet: string,
        @Query() query: TransactionHistoryQueryDto,
    ) {
        return this.transactionHistoryService.getTransactionHistory(
            wallet,
            query,
        );
    }
}
