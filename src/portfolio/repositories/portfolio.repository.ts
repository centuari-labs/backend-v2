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

    async setAssetAsCollateral(accountId: string, assetIds: string[], isCollateral: boolean) {
        return this.createQueryBuilder('portfolio')
            .update({ isCollateral })
            .where('portfolio.account_id = :accountId', { accountId })
            .andWhere('portfolio.asset_id IN (:...assetIds)', { assetIds })
            .execute();
    }
}