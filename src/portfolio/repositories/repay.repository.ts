import { Injectable } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { Token } from "../../tokens/entities/token.entity";

@Injectable()
export class RepayRepository {
    constructor(private readonly dataSource: DataSource) {}

    async getBorrowPositionById(
        positionId: string,
        accountId: string,
        manager?: EntityManager,
    ): Promise<any> {
        const qb = (manager || this.dataSource)
            .createQueryBuilder()
            .select("bp.id", "id")
            .addSelect("bp.debt", "debt")
            .addSelect("bp.market_id", "marketId")
            .addSelect("bp.account_id", "accountId")
            .from("borrow_positions", "bp")
            .where("bp.id = :positionId", { positionId })
            .andWhere("bp.account_id = :accountId", { accountId })
            .andWhere("bp.debt > 0");

        if (manager) {
            qb.setLock("pessimistic_write");
        }

        return qb.getRawOne();
    }

    async getUserTotalDebt(
        accountId: string,
        marketId: string,
    ): Promise<string> {
        const result = await this.dataSource
            .createQueryBuilder()
            .select("SUM(debt)", "total_debt")
            .from("borrow_positions", "bp")
            .where("bp.account_id = :accountId", { accountId })
            .andWhere("bp.market_id = :marketId", { marketId })
            .getRawOne();
        return result?.total_debt || "0";
    }

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

    async getBorrowPositions(
        accountId: string,
        marketId: string,
        manager?: EntityManager,
    ): Promise<any[]> {
        const qb = (manager || this.dataSource)
            .createQueryBuilder()
            .select("bp.id", "id")
            .addSelect("bp.debt", "debt")
            .from("borrow_positions", "bp")
            .where("bp.account_id = :accountId", { accountId })
            .andWhere("bp.market_id = :marketId", { marketId })
            .andWhere("bp.debt > 0")
            .orderBy("bp.created_at", "ASC");

        if (manager) {
            qb.setLock("pessimistic_write");
        }

        return qb.getRawMany();
    }

    async updateBorrowPositionDebt(
        manager: EntityManager,
        positionId: string,
        debt: string,
    ): Promise<void> {
        await manager
            .createQueryBuilder()
            .update("borrow_positions")
            .set({ debt, updatedAt: () => "NOW()" })
            .where("id = :positionId", { positionId })
            .execute();
    }
}
