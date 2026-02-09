import { Injectable } from "@nestjs/common";
import { DataSource, Repository } from "typeorm";
import { Market } from "../entities/market.entity";

@Injectable()
export class MarketRepositories extends Repository<Market> {
    constructor(private dataSource: DataSource) {
        super(Market, dataSource.createEntityManager());
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
}
