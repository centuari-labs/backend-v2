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
    filled_quantity: string;
    status: OrderStatus;
    symbol: string;
    name: string;
    token_address: string;
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
            .select('o.asset_id', 'asset_id')
            .addSelect('AVG(o.rate)', 'net_apy') // Using AVG for net APY across open lend positions
            .from('orders', 'o')
            .where('o.account_id = :accountId', { accountId })
            .andWhere('o.side = :side', { side: OrderSide.Lend })
            .andWhere('o.status IN (:...statuses)', { statuses: [OrderStatus.Open, OrderStatus.PartiallyFilled] })
            .groupBy('o.asset_id')
            .getRawMany();
    }

    async getUserSuppliedAssets(accountId: string): Promise<{ asset_id: string, amount: string }[]> {
        // Assets in portfolio with amount > 0 are considered supplied/deposited
        return this.createQueryBuilder('portfolio')
            .select('portfolio.asset_id', 'asset_id')
            .addSelect('SUM(portfolio.amount)', 'amount')
            .where('portfolio.account_id = :accountId', { accountId })
            .andWhere('portfolio.amount > 0')
            .groupBy('portfolio.asset_id')
            .getRawMany();
    }

    async getUserBorrowedAssets(accountId: string): Promise<{ asset_id: string, amount: string }[]> {
        // In this system, borrowed assets seem to be handled by orders or negative balances.
        // If borrowed is represented by negative portfolio amount:
        return this.createQueryBuilder('portfolio')
            .select('portfolio.asset_id', 'asset_id')
            .addSelect('ABS(SUM(portfolio.amount))', 'amount')
            .where('portfolio.account_id = :accountId', { accountId })
            .andWhere('portfolio.amount < 0')
            .groupBy('portfolio.asset_id')
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
        const skip = (page - 1) * limit;

        const queryBuilder = this.dataSource
            .createQueryBuilder()
            .select([
                'o.id AS order_id',
                'o.asset_id AS asset_id',
                'o.side AS side',
                'o.rate AS rate',
                'o.quantity AS quantity',
                'o.filled_quantity AS filled_quantity',
                'o.status AS status',
                't.symbol AS symbol',
                't.name AS name',
                't.token_address AS token_address',
            ])
            .from('orders', 'o')
            .innerJoin('assets', 't', 'o.asset_id = t.id')
            .where('o.account_id = :accountId', { accountId })
            .andWhere('o.side IN (:...sides)', {
                sides: positionType ? [positionType] : [OrderSide.Lend, OrderSide.Borrow],
            })
            .andWhere('o.status IN (:...statuses)', {
                statuses: [OrderStatus.Open, OrderStatus.PartiallyFilled],
            })
            .orderBy('o.created_at', 'DESC')
            .offset(skip)
            .limit(limit);

        const data = await queryBuilder.getRawMany<RawPosition>();

        const countQuery = this.dataSource
            .createQueryBuilder()
            .select('COUNT(*)', 'count')
            .from('orders', 'o')
            .where('o.account_id = :accountId', { accountId })
            .andWhere('o.side IN (:...sides)', {
                sides: positionType ? [positionType] : [OrderSide.Lend, OrderSide.Borrow],
            })
            .andWhere('o.status IN (:...statuses)', {
                statuses: [OrderStatus.Open, OrderStatus.PartiallyFilled],
            });

        const countResult = await countQuery.getRawOne<{ count: string }>();
        const total = Number.parseInt(countResult?.count || '0', 10);

        return { data, total };
    }

    async getCollateralAssets(accountId: string): Promise<{
        asset_id: string;
        symbol: string;
        name: string;
    }[]> {
        return this.dataSource
            .createQueryBuilder()
            .select([
                'p.asset_id AS asset_id',
                't.symbol AS symbol',
                't.name AS name',
            ])
            .from('portfolio', 'p')
            .innerJoin('assets', 't', 'p.asset_id = t.id')
            .where('p.account_id = :accountId', { accountId })
            .andWhere('p.is_collateral = true', { accountId })
            .andWhere('p.amount > 0')
            .getRawMany();
    }
}