import { Injectable } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { Token } from "../../tokens/entities/token.entity";

@Injectable()
export class RepayRepository {
    constructor(private readonly dataSource: DataSource) { }

    async getAssetIdByTokenAddress(tokenAddress: string): Promise<string | null> {
        const result = await this.dataSource.getRepository(Token)
            .createQueryBuilder("token")
            .select("token.id", "id")
            .where("LOWER(token.token_address) = LOWER(:tokenAddress)", { tokenAddress })
            .getRawOne();
        return result?.id || null;
    }


    async getUserTotalDebt(
        accountId: string,
        assetId: string,
    ): Promise<string> {
        const result = await this.dataSource.createQueryBuilder()
            .select("SUM(debt)", "total_debt")
            .from("borrow_positions", "bp")
            .where("bp.account_id = :accountId", { accountId })
            .andWhere("bp.asset_id = :assetId", { assetId })
            .getRawOne();
        return result?.total_debt || "0";
    }

    async getBorrowPositions(
        accountId: string,
        assetId: string,
    ): Promise<any[]> {
        return this.dataSource.createQueryBuilder()
            .select("bp.id", "id")
            .addSelect("bp.debt", "debt")
            .addSelect("CAST(EXTRACT(EPOCH FROM m.maturity AT TIME ZONE 'UTC') AS BIGINT)", "maturity")
            .from("borrow_positions", "bp")
            .innerJoin("markets", "m", "bp.market_id = m.id")
            .where("bp.account_id = :accountId", { accountId })
            .andWhere("bp.asset_id = :assetId", { assetId })
            .andWhere("bp.debt > 0")
            .orderBy("bp.created_at", "ASC")
            .getRawMany();
    }

    async getBorrowPositionsForUpdate(
        manager: EntityManager,
        accountId: string,
        assetId: string,
    ): Promise<any[]> {
        return manager.createQueryBuilder()
            .select("bp.id", "id")
            .addSelect("bp.debt", "debt")
            .addSelect("CAST(EXTRACT(EPOCH FROM m.maturity AT TIME ZONE 'UTC') AS BIGINT)", "maturity")
            .from("borrow_positions", "bp")
            .innerJoin("markets", "m", "bp.market_id = m.id")
            .where("bp.account_id = :accountId", { accountId })
            .andWhere("bp.asset_id = :assetId", { assetId })
            .andWhere("bp.debt > 0")
            .orderBy("bp.created_at", "ASC")
            .setLock("pessimistic_write")
            .getRawMany();
    }

    async deleteBorrowPosition(
        manager: EntityManager,
        positionId: string,
    ): Promise<void> {
        await manager.createQueryBuilder()
            .delete()
            .from("borrow_positions")
            .where("id = :positionId", { positionId })
            .execute();
    }

    async updateBorrowPositionDebt(
        manager: EntityManager,
        positionId: string,
        debt: string,
    ): Promise<void> {
        await manager.createQueryBuilder()
            .update("borrow_positions")
            .set({ debt, updatedAt: () => "NOW()" })
            .where("id = :positionId", { positionId })
            .execute();
    }
}
