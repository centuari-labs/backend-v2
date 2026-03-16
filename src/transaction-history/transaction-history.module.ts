import { Module } from "@nestjs/common";
import { CoreModule } from "../core/core.module";
import { OrdersModule } from "../orders/orders.module";
import { TransactionHistoryController } from "./transaction-history.controller";
import { TransactionHistoryService } from "./transaction-history.service";
import { TransactionHistoryRepository } from "./repositories/transaction-history.repository";

@Module({
    imports: [CoreModule, OrdersModule],
    controllers: [TransactionHistoryController],
    providers: [TransactionHistoryService, TransactionHistoryRepository],
})
export class TransactionHistoryModule {}
