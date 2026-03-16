import { Injectable } from "@nestjs/common";
import { OrderRepository } from "../orders/repositories/order.repository";
import {
    TransactionHistoryRepository,
    RawTransactionRow,
} from "./repositories/transaction-history.repository";
import {
    TransactionHistoryQueryDto,
    TransactionHistoryItem,
} from "./dto/transaction-history.dto";
import { createPaginatedResponse } from "../portfolio/helpers/position.helpers";
import { baseUnitsToHuman, toPercentage } from "../common/utils/number.utils";

@Injectable()
export class TransactionHistoryService {
    constructor(
        private readonly orderRepository: OrderRepository,
        private readonly transactionHistoryRepository: TransactionHistoryRepository,
    ) {}

    async getTransactionHistory(
        wallet: string,
        query: TransactionHistoryQueryDto,
    ) {
        const page = query.page ?? 1;
        const limit = query.limit ?? 10;

        const account = await this.orderRepository.findAccountByWallet(wallet);
        if (!account) {
            return createPaginatedResponse([], 0, page, limit);
        }

        const { data, total } =
            await this.transactionHistoryRepository.getTransactionHistory(
                account.id,
                page,
                limit,
                query.type,
            );

        if (data.length === 0) {
            return createPaginatedResponse([], total, page, limit);
        }

        const items: TransactionHistoryItem[] = data.map(
            (row: RawTransactionRow) => {
                const decimals = Number(row.decimals) || 0;

                return {
                    id: row.id,
                    type: row.type as "MATCH" | "ORDER",
                    side: row.side,
                    orderType: row.order_type,
                    rate: toPercentage(Number(row.rate)),
                    amount: baseUnitsToHuman(row.amount, decimals),
                    filledQuantity: row.filled_quantity
                        ? baseUnitsToHuman(row.filled_quantity, decimals)
                        : null,
                    status: row.status,
                    symbol: row.symbol,
                    imageUrl: row.image_url,
                    decimals,
                    tokenAddress: row.token_address,
                    maturity: row.maturity
                        ? new Date(row.maturity).getTime() / 1000
                        : null,
                    fees: row.fees
                        ? baseUnitsToHuman(row.fees, decimals)
                        : null,
                    createdAt: row.created_at,
                };
            },
        );

        return createPaginatedResponse(items, total, page, limit);
    }
}
