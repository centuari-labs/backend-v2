import { Injectable } from "@nestjs/common";
import { Portfolio } from "../entities/portfolio.entity";
import { DataSource, Repository } from "typeorm";
import { OrderSide, OrderStatus } from "../../orders/constants/order.constants";

export interface RawPosition {
    order_id: string;
    asset_id: string;
    side: OrderSide;
    rate: string;
    quantity: string;
    status: OrderStatus;
    symbol: string;
    name: string;
    token_address: string;
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

    async getUserNetAPY(accountId: string): Promise<{ asset_id: string, net_apy: string }[]> {
        return this.dataSource.createQueryBuilder()
            .select('lp.asset_id', 'asset_id')
            .addSelect('AVG(m.rate)', 'net_apy')
            .from('lend_positions', 'lp')
            .innerJoin('order_markets', 'om', 'lp.market_id = om.market_id')
            .innerJoin('matches', 'm', 'om.order_market_id = m.lend_order_market_id')
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

    async isCollateral(accountId: string) {
        return this.dataSource
            .createQueryBuilder()
            .select([
                'portfolio.asset_id AS asset_id',
                'portfolio.is_collateral AS is_collateral'
            ])
            .from('portfolio', 'portfolio')
            .where('portfolio.account_id = :accountId', { accountId })
            .andWhere('portfolio.amount > 0')
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
        const queryParams: any[] = [accountId];

        if (includeLend) {
            queries.push(`
                SELECT 
                    lp.id AS order_id,
                    lp.asset_id AS asset_id,
                    'LEND' AS side,
                    '0' AS rate,
                    lp.amount AS quantity,
                    '${OrderStatus.Filled}' AS status,
                    t.symbol AS symbol,
                    t.name AS name,
                    t.token_address AS token_address,
                    lp.created_at AS created_at
                FROM lend_positions lp
                INNER JOIN assets t ON lp.asset_id = t.id
                WHERE lp.account_id = $1 AND lp.amount > 0
            `);
            countQueries.push(`
                SELECT id FROM lend_positions WHERE account_id = $1 AND amount > 0
            `);
        }

        if (includeBorrow) {
            queries.push(`
                SELECT 
                    bp.id AS order_id,
                    bp.asset_id AS asset_id,
                    'BORROW' AS side,
                    '0' AS rate,
                    bp.debt AS quantity,
                    '${OrderStatus.Filled}' AS status,
                    t.symbol AS symbol,
                    t.name AS name,
                    t.token_address AS token_address,
                    bp.created_at AS created_at
                FROM borrow_positions bp
                INNER JOIN assets t ON bp.asset_id = t.id
                WHERE bp.account_id = $1 AND bp.debt > 0
            `);
            countQueries.push(`
                SELECT id FROM borrow_positions WHERE account_id = $1 AND debt > 0
            `);
        }

        if (queries.length === 0) {
            return { data: [], total: 0 };
        }

        queryParams.push(limit, offset);

        const finalQuery = queries.join(' UNION ALL ') + ` ORDER BY created_at DESC LIMIT $2 OFFSET $3`;
        const countQuery = `SELECT COUNT(*) as count FROM (${countQueries.join(' UNION ALL ')}) as combined_count`;

        const data = await this.dataSource.query(finalQuery, queryParams);
        const countResult = await this.dataSource.query(countQuery, [accountId]);

        const total = Number.parseInt(countResult[0]?.count || '0', 10);

        return { data, total };
    }
}