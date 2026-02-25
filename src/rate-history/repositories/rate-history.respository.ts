import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { OrderSide, OrderStatus } from "../../orders/constants/order.constants";
import { RateHistoryItemDto } from "../dto/rate-history.dto";

@Injectable()
export class RateRepository {
    constructor(private readonly dataSource: DataSource) { }

    async getRateHistoryByAssetId(assetId: string): Promise<RateHistoryItemDto[]> {
        const results = await this.dataSource
            .createQueryBuilder()
            .select("DATE(o.created_at)", "date")
            .addSelect("MIN(o.rate)", "best_rate")
            .from("orders", "o")
            .where("o.asset_id = :assetId", { assetId })
            .andWhere("o.status IN (:...statuses)", {
                statuses: [OrderStatus.Open, OrderStatus.Filled, OrderStatus.PartiallyFilled],
            })
            .andWhere("o.side = :side", { side: OrderSide.Borrow })
            .groupBy("DATE(o.created_at)")
            .orderBy("date", "ASC")
            .getRawMany<{ date: string; best_rate: string }>();

        return results.map((row) => ({
            date: row.date,
            rate: Number.parseFloat(row.best_rate),
        }));
    }
}