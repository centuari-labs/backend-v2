import { Injectable } from "@nestjs/common";
import { Portfolio } from "../entities/portfolio.entity";
import { DataSource, Repository } from "typeorm";
import { OrderSide, OrderStatus } from "../../orders/constants/order.constants";

export interface RawPosition {
    position_id: string;
    asset_id: string;
    side: OrderSide;
    rate: string;
    quantity: string;
    status: OrderStatus;
    symbol: string;
    name: string;
    token_address: string;
    maturity: Date | null;
    created_at: Date;
}

@Injectable()
export class PortfolioRepository extends Repository<Portfolio> {
    constructor(private dataSource: DataSource) {
        super(Portfolio, dataSource.createEntityManager());
    }

    async getUserTotalBalances(accountId: string): Promise<{ asset_id: string, total_amount: string }[]> {
        return this.createQueryBuilder('portfolio')
            .select('portfolio.asset_id', 'asset_id')
            .addSelect('SUM(portfolio.amount)', 'total_amount')
            .where('portfolio.account_id = :accountId', { accountId })
            .groupBy('portfolio.asset_id')
            .getRawMany();
    }

    //@todo : find how to get net APR from user's lend position shares
    //@todo : change the function name into getUserNetAPR
    async getUserNetAPY(accountId: string): Promise<{ asset_id: string, net_apy: string }[]> {
        return this.dataSource.createQueryBuilder()
            .select('lp.asset_id', 'asset_id')
            .addSelect("'0'", 'net_apy')
            .from('lend_positions', 'lp')
            .where('lp.account_id = :accountId', { accountId })
            .andWhere('lp.amount > 0')
            .groupBy('lp.asset_id')
            .getRawMany();
    }

    async getUserSuppliedAssets(accountId: string): Promise<{ asset_id: string, amount: string }[]> {
        return this.dataSource.createQueryBuilder()
            .select('lp.asset_id', 'asset_id')
            .addSelect('SUM(lp.amount)', 'amount')
            .from('lend_positions', 'lp')
            .where('lp.account_id = :accountId', { accountId })
            .andWhere('lp.amount > 0')
            .groupBy('lp.asset_id')
            .getRawMany();
    }

    async getUserBorrowedAssets(accountId: string): Promise<{ asset_id: string, amount: string }[]> {
        return this.dataSource.createQueryBuilder()
            .select('bp.asset_id', 'asset_id')
            .addSelect('SUM(bp.debt)', 'amount')
            .from('borrow_positions', 'bp')
            .where('bp.account_id = :accountId', { accountId })
            .andWhere('bp.debt > 0')
            .groupBy('bp.asset_id')
            .getRawMany();
    }


    async getUserAssets(
        accountId: string,
        page = 1,
        limit = 10
    ): Promise<{ data: any[], total: number }> {
        const skip = (page - 1) * limit;

        const queryBuilder = this.createQueryBuilder('portfolio')
            .select([
                'portfolio.asset_id AS asset_id',
                'portfolio.amount AS amount',
                'portfolio.is_collateral AS is_collateral'
            ])
            .where('portfolio.account_id = :accountId', { accountId })
            .andWhere('portfolio.amount > 0')
            .skip(skip)
            .take(limit);

        const data = await queryBuilder.getRawMany();
        const total = await queryBuilder.getCount();

        return { data, total };
    }

    async getUserPositions(
        accountId: string,
        positionType?: 'LEND' | 'BORROW',
        page = 1,
        limit = 10
    ): Promise<{ data: RawPosition[]; total: number }> {
        const offset = (page - 1) * limit;
        const includeLend = !positionType || positionType === 'LEND';
        const includeBorrow = !positionType || positionType === 'BORROW';

        const queries: string[] = [];
        const countQueries: string[] = [];

        //@todo : use query builder instead of raw queries
        //@todo : get rate base on the shares
        if (includeLend) {
            queries.push(`
                SELECT 
                    lp.id AS position_id,
                    lp.asset_id AS asset_id,
                    'LEND' AS side,
                    '0' AS rate, -- Placeholder: should use lp.rate if exists
                    lp.amount AS quantity,
                    t.symbol AS symbol,
                    t.name AS name,
                    t.token_address AS token_address,
                    m.maturity AS maturity,
                    lp.created_at AS created_at
                FROM lend_positions lp
                INNER JOIN assets t ON lp.asset_id = t.id
                LEFT JOIN markets m ON lp.market_id = m.id
                WHERE lp.account_id = $1 AND lp.amount > 0
            `);
            countQueries.push(`
                SELECT id FROM lend_positions WHERE account_id = $1 AND amount > 0
            `);
        }

        //@todo : get rate base on shares
        if (includeBorrow) {
            queries.push(`
                SELECT 
                    bp.id AS position_id,
                    bp.asset_id AS asset_id,
                    'BORROW' AS side,
                    '0' AS rate, -- Placeholder
                    bp.debt AS quantity,
                    t.symbol AS symbol,
                    t.name AS name,
                    t.token_address AS token_address,
                    m.maturity AS maturity,
                    bp.created_at AS created_at
                FROM borrow_positions bp
                INNER JOIN assets t ON bp.asset_id = t.id
                LEFT JOIN markets m ON bp.market_id = m.id
                WHERE bp.account_id = $1 AND bp.debt > 0
            `);
            countQueries.push(`
                SELECT id FROM borrow_positions WHERE account_id = $1 AND debt > 0
            `);
        }

        if (queries.length === 0) {
            return { data: [], total: 0 };
        }

        const finalQuery = `
            SELECT * FROM (
                ${queries.join(' UNION ALL ')}
            ) combined_positions
            ORDER BY created_at DESC 
            LIMIT $2 OFFSET $3
        `;

        const countQuery = `SELECT COUNT(*) as count FROM (${countQueries.join(' UNION ALL ')}) as combined_count`;

        const data = await this.dataSource.query(finalQuery, [accountId, limit, offset]);
        const countResult = await this.dataSource.query(countQuery, [accountId]);

        return {
            data,
            total: Number.parseInt(countResult[0]?.count || '0', 10)
        };
    }

    async setAssetAsCollateral(accountId: string, assetIds: string[], isCollateral: boolean) {
        return this.createQueryBuilder('portfolio')
            .update({ isCollateral })
            .where('portfolio.account_id = :accountId', { accountId })
            .andWhere('portfolio.asset_id IN (:...assetIds)', { assetIds })
            .execute();
    }
}