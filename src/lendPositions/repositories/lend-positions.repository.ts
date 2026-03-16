import { Injectable } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";

@Injectable()
export class LendPositionsRepository {
    constructor(private readonly dataSource: DataSource) {}

    async getMarketWithAsset(marketId: string): Promise<any> {
        return this.dataSource
            .createQueryBuilder()
            .select("m.id", "id")
            .addSelect("m.maturity", "maturity")
            .addSelect("a.decimals", "decimals")
            .addSelect("a.token_address", "tokenAddress")
            .from("markets", "m")
            .innerJoin("assets", "a", "m.asset_id = a.id")
            .where("m.id = :marketId", { marketId })
            .getRawOne();
    }

    async getLendPositions(
        accountId: string,
        marketId: string,
        manager?: EntityManager,
    ): Promise<any[]> {
        const qb = (manager || this.dataSource)
            .createQueryBuilder()
            .select("lp.id", "id")
            .addSelect("lp.shares", "shares")
            .addSelect("lp.amount", "amount")
            .from("lend_positions", "lp")
            .where("lp.account_id = :accountId", { accountId })
            .andWhere("lp.market_id = :marketId", { marketId })
            .andWhere("lp.shares > 0")
            .orderBy("lp.created_at", "ASC");

        if (manager) {
            qb.setLock("pessimistic_write");
        }

        return qb.getRawMany();
    }

    async updateLendPositionShares(
        manager: EntityManager,
        positionId: string,
        shares: string,
    ): Promise<void> {
        await manager
            .createQueryBuilder()
            .update("lend_positions")
            .set({ shares, updatedAt: () => "NOW()" })
            .where("id = :positionId", { positionId })
            .execute();
    }
}
