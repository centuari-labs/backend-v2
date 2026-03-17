import { Injectable } from "@nestjs/common";
import { Portfolio } from "../entities/portfolio.entity";
import { DataSource, In, Repository } from "typeorm";
import { OrderSide, OrderStatus } from "../../orders/constants/order.constants";
import { Token } from "../../tokens/entities/token.entity";

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
    image_url: string | null;
    decimals: number;
    maturity: Date | null;
    created_at: Date;
}

export interface RawTransactionRow {
    id: string;
    side: string;
    order_type: string | null;
    rate: string;
    amount: string;
    filled_quantity: string | null;
    status: string;
    symbol: string;
    image_url: string | null;
    decimals: string;
    token_address: string;
    created_at: string;
}

export interface LendPositionForApr {
    asset_id: string;
    shares: string;
    amount: string;
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

    async getUserLendPositionsForApr(accountId: string): Promise<LendPositionForApr[]> {
        return this.dataSource.createQueryBuilder()
            .select('lp.asset_id', 'asset_id')
            .addSelect('lp.shares', 'shares')
            .addSelect('lp.amount', 'amount')
            .addSelect('lp.created_at', 'created_at')
            .from('lend_positions', 'lp')
            .where('lp.account_id = :accountId', { accountId })
            .andWhere('lp.shares > 0')
            .getRawMany();
    }

    async getUserSuppliedAssets(accountId: string): Promise<{ asset_id: string, amount: string }[]> {
        return this.dataSource.createQueryBuilder()
            .select('lp.asset_id', 'asset_id')
            .addSelect('SUM(lp.shares)', 'amount')
            .from('lend_positions', 'lp')
            .where('lp.account_id = :accountId', { accountId })
            .andWhere('lp.shares > 0')
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

    /** Collateral-only positions: portfolio rows where is_collateral = true, amounts in base units. */
    async getUserCollateralAssets(accountId: string): Promise<{ asset_id: string; amount: string }[]> {
        return this.createQueryBuilder("portfolio")
            .select("portfolio.asset_id", "asset_id")
            .addSelect("SUM(portfolio.amount)", "amount")
            .where("portfolio.account_id = :accountId", { accountId })
            .andWhere("portfolio.is_collateral = :isCollateral", { isCollateral: true })
            .andWhere("portfolio.amount > 0")
            .groupBy("portfolio.asset_id")
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
        const includeLend = !positionType || positionType === 'LEND';
        const includeBorrow = !positionType || positionType === 'BORROW';

        const lendResults: RawPosition[] = [];
        const borrowResults: RawPosition[] = [];
        let lendCount = 0;
        let borrowCount = 0;

        if (includeLend) {
            const lendQuery = this.dataSource.createQueryBuilder()
                .select('lp.id', 'position_id')
                .addSelect('lp.asset_id', 'asset_id')
                .addSelect("'LEND'", 'side')
                .addSelect(
                    'CASE WHEN lp.amount > 0 THEN ((lp.shares / lp.amount - 1) * 100) ELSE 0 END',
                    'rate',
                )
                .addSelect('lp.amount', 'quantity')
                .addSelect('t.symbol', 'symbol')
                .addSelect('t.name', 'name')
                .addSelect('t.token_address', 'token_address')
                .addSelect('t.image_url', 'image_url')
                .addSelect('COALESCE(t.decimals, 0)', 'decimals')
                .addSelect('m.maturity', 'maturity')
                .addSelect('lp.created_at', 'created_at')
                .from('lend_positions', 'lp')
                .innerJoin('assets', 't', 'lp.asset_id = t.id')
                .leftJoin('markets', 'm', 'lp.market_id = m.id')
                .where('lp.account_id = :accountId', { accountId })
                .andWhere('lp.amount > 0');

            const [rows, countResult] = await Promise.all([
                lendQuery.getRawMany(),
                this.dataSource.createQueryBuilder()
                    .select('COUNT(*)', 'count')
                    .from('lend_positions', 'lp')
                    .where('lp.account_id = :accountId', { accountId })
                    .andWhere('lp.amount > 0')
                    .getRawOne(),
            ]);

            lendResults.push(...rows);
            lendCount = Number.parseInt(countResult?.count || '0', 10);
        }

        if (includeBorrow) {
            const borrowQuery = this.dataSource.createQueryBuilder()
                .select('bp.id', 'position_id')
                .addSelect('bp.asset_id', 'asset_id')
                .addSelect("'BORROW'", 'side')
                .addSelect(
                    'CASE WHEN bp.amount > 0 THEN ((bp.debt / bp.amount - 1) * 100) ELSE 0 END',
                    'rate',
                )
                .addSelect('bp.debt', 'quantity')
                .addSelect('t.symbol', 'symbol')
                .addSelect('t.name', 'name')
                .addSelect('t.token_address', 'token_address')
                .addSelect('t.image_url', 'image_url')
                .addSelect('COALESCE(t.decimals, 0)', 'decimals')
                .addSelect('m.maturity', 'maturity')
                .addSelect('bp.created_at', 'created_at')
                .from('borrow_positions', 'bp')
                .innerJoin('assets', 't', 'bp.asset_id = t.id')
                .leftJoin('markets', 'm', 'bp.market_id = m.id')
                .where('bp.account_id = :accountId', { accountId })
                .andWhere('bp.debt > 0');

            const [rows, countResult] = await Promise.all([
                borrowQuery.getRawMany(),
                this.dataSource.createQueryBuilder()
                    .select('COUNT(*)', 'count')
                    .from('borrow_positions', 'bp')
                    .where('bp.account_id = :accountId', { accountId })
                    .andWhere('bp.debt > 0')
                    .getRawOne(),
            ]);

            borrowResults.push(...rows);
            borrowCount = Number.parseInt(countResult?.count || '0', 10);
        }

        const combined = [...lendResults, ...borrowResults]
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

        const total = lendCount + borrowCount;
        const offset = (page - 1) * limit;
        const data = combined.slice(offset, offset + limit);

        return { data, total };
    }

    async getTokensByAssetIds(assetIds: string[]): Promise<Token[]> {
        return this.dataSource.getRepository(Token).find({
            where: { id: In(assetIds) },
        });
    }

    async getRiskParamsByCollateralTokenIds(
        assetIds: string[],
    ): Promise<{ asset_id: string; avg_ltv: string; avg_lt: string }[]> {
        return this.dataSource.query(
            `SELECT collateral_token_id AS asset_id, AVG(ltv) AS avg_ltv, AVG(lt) AS avg_lt
             FROM risk
             WHERE collateral_token_id = ANY($1)
             GROUP BY collateral_token_id`,
            [assetIds],
        );
    }

    async getUserDailyLendBorrow(
        accountId: string,
        days: number,
    ): Promise<
        { date: string; lend_amount: string; borrow_amount: string }[]
    > {
        const query = `
            SELECT
                d.date::date as date,
                COALESCE(lend.total, 0) as lend_amount,
                COALESCE(borrow.total, 0) as borrow_amount
            FROM generate_series(
                CURRENT_DATE - ($2 || ' days')::interval,
                CURRENT_DATE,
                '1 day'::interval
            ) AS d(date)
            LEFT JOIN (
                SELECT DATE(m.created_at) as date, SUM(m.match_amount) as total
                FROM matches m
                WHERE m.lender_account_id = $1
                AND m.created_at >= CURRENT_DATE - ($2 || ' days')::interval
                GROUP BY DATE(m.created_at)
            ) lend ON lend.date = d.date::date
            LEFT JOIN (
                SELECT DATE(m.created_at) as date, SUM(m.match_amount) as total
                FROM matches m
                WHERE m.borrower_account_id = $1
                AND m.created_at >= CURRENT_DATE - ($2 || ' days')::interval
                GROUP BY DATE(m.created_at)
            ) borrow ON borrow.date = d.date::date
            ORDER BY d.date ASC
        `;

        return this.dataSource.query(query, [accountId, days]);
    }

    async setAssetAsCollateral(accountId: string, assetIds: string[], isCollateral: boolean) {
        return this.createQueryBuilder('portfolio')
            .update({ isCollateral })
            .where('portfolio.account_id = :accountId', { accountId })
            .andWhere('portfolio.asset_id IN (:...assetIds)', { assetIds })
            .execute();
    }

    /**
     * Upserts portfolio: insert or on conflict add amount.
     * Matches indexer Treasury:Deposited behavior.
     */
    async upsertPortfolio(
        id: string,
        accountId: string,
        assetId: string,
        amountDelta: string,
    ): Promise<void> {
        await this.dataSource.query(
            `INSERT INTO portfolio (id, account_id, asset_id, amount, is_collateral)
             VALUES ($1, $2, $3, $4, false)
             ON CONFLICT (account_id, asset_id) DO UPDATE SET
               amount = portfolio.amount + EXCLUDED.amount::numeric,
               updated_at = NOW()`,
            [id, accountId, assetId, amountDelta],
        );
    }

    /**
     * Syncs portfolio balance from on-chain treasury balance.
     * Replaces amount on conflict (SET) rather than adding (upsertPortfolio).
     * Used by OrdersWorker to ensure DB reflects on-chain state regardless of event parsing.
     */
    async getTransactionHistory(
        accountId: string,
        page: number,
        limit: number,
    ): Promise<{ data: RawTransactionRow[]; total: number }> {
        const offset = (page - 1) * limit;

        const dataQuery = `
            SELECT o.id, o.side::text, o.type::text as order_type, o.rate,
                   o.quantity as amount, o.filled_quantity, o.status::text,
                   a.symbol, a.image_url, COALESCE(a.decimals, 0) as decimals,
                   a.token_address, o.created_at
            FROM orders o
            JOIN assets a ON o.asset_id = a.id
            WHERE o.account_id = $1
            ORDER BY o.created_at DESC
            LIMIT $2 OFFSET $3
        `;

        const countQuery = `
            SELECT COUNT(*) as count
            FROM orders o
            WHERE o.account_id = $1
        `;

        const [rows, countResult] = await Promise.all([
            this.dataSource.query(dataQuery, [accountId, limit, offset]),
            this.dataSource.query(countQuery, [accountId]),
        ]);

        return {
            data: rows,
            total: Number.parseInt(countResult[0]?.count || "0", 10),
        };
    }

    async syncPortfolioBalance(
        id: string,
        accountId: string,
        assetId: string,
        amount: string,
        isCollateral: boolean = false,
    ): Promise<void> {
        await this.dataSource.query(
            `INSERT INTO portfolio (id, account_id, asset_id, amount, is_collateral)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (account_id, asset_id) DO UPDATE SET
               amount = $4::numeric,
               is_collateral = CASE WHEN $5::boolean THEN true ELSE portfolio.is_collateral END,
               updated_at = NOW()`,
            [id, accountId, assetId, amount, isCollateral],
        );
    }
}