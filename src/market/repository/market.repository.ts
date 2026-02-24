import { Injectable } from "@nestjs/common";
import { DataSource, In, Repository } from "typeorm";
import { Market } from "../entities/market.entity";

@Injectable()
export class MarketRepositories extends Repository<Market> {
    constructor(private dataSource: DataSource) {
        super(Market, dataSource.createEntityManager());
    }

    async getMarketsByIds(marketIds: string[]): Promise<Market[]> {
        if (marketIds.length === 0) {
            return [];
        }
        return this.find({
            where: { id: In(marketIds) },
        });
    }

    async getTotalDepositUsd(): Promise<{ asset_id: string; total_amount: string }[]> {
        return this.dataSource.createQueryBuilder()
            .select('portfolio.asset_id', 'asset_id')
            .addSelect('SUM(portfolio.amount)', 'total_amount')
            .from('portfolio', 'portfolio')
            .groupBy('portfolio.asset_id')
            .getRawMany();
    }

    async getActiveLoans(): Promise<{ asset_id: string; total_amount: string }[]> {
        return this.dataSource.createQueryBuilder()
            .select('lend_positions.asset_id', 'asset_id')
            .addSelect('SUM(lend_positions.amount)', 'total_amount')
            .from('lend_positions', 'lend_positions')
            .groupBy('lend_positions.asset_id')
            .getRawMany();
    }

    async getMarketId(marketId: string): Promise<string | undefined> {
        return this.dataSource.createQueryBuilder()
            .select('market.id', 'id')
            .from('market', 'market')
            .where('market.id = :marketId', { marketId })
            .getRawOne();
    }
}