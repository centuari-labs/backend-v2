import { Injectable } from "@nestjs/common";
import { DataSource, QueryRunner } from "typeorm";

@Injectable()
export class RepayRepository {
    constructor(private readonly dataSource: DataSource) {}

    createQueryRunner(): QueryRunner {
        return this.dataSource.createQueryRunner();
    }

    async getUserTotalDebt(
        accountId: string,
        assetId: string,
    ): Promise<string> {
        const result = await this.dataSource.query(
            `SELECT SUM(debt) as total_debt 
             FROM borrow_positions 
             WHERE account_id = $1 AND asset_id = $2`,
            [accountId, assetId],
        );
        return result[0]?.total_debt || "0";
    }

    async getBorrowPositionsForUpdate(
        queryRunner: QueryRunner,
        accountId: string,
        assetId: string,
    ): Promise<any[]> {
        return queryRunner.query(
            `SELECT bp.id, bp.debt, m.maturity
             FROM borrow_positions bp
             JOIN markets m ON bp.market_id = m.id
             WHERE bp.account_id = $1 AND bp.asset_id = $2 AND bp.debt > 0
             ORDER BY bp.created_at ASC
             FOR UPDATE OF bp`,
            [accountId, assetId],
        );
    }

    async deleteBorrowPosition(
        queryRunner: QueryRunner,
        positionId: string,
    ): Promise<void> {
        await queryRunner.query(`DELETE FROM borrow_positions WHERE id = $1`, [
            positionId,
        ]);
    }

    async updateBorrowPositionDebt(
        queryRunner: QueryRunner,
        positionId: string,
        debt: string,
    ): Promise<void> {
        await queryRunner.query(
            `UPDATE borrow_positions SET debt = $1, updated_at = NOW() WHERE id = $2`,
            [debt, positionId],
        );
    }
}
