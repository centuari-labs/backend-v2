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

    async getTotalDepositUsd(): Promise<
        { asset_id: string; total_amount: string }[]
    > {
        return this.dataSource
            .createQueryBuilder()
            .select("portfolio.asset_id", "asset_id")
            .addSelect("SUM(portfolio.amount)", "total_amount")
            .from("portfolio", "portfolio")
            .groupBy("portfolio.asset_id")
            .getRawMany();
    }

    async getActiveLoans(): Promise<
        { asset_id: string; total_amount: string }[]
    > {
        return this.dataSource
            .createQueryBuilder()
            .select("lend_positions.asset_id", "asset_id")
            .addSelect("SUM(lend_positions.amount)", "total_amount")
            .from("lend_positions", "lend_positions")
            .groupBy("lend_positions.asset_id")
            .getRawMany();
    }

    async getMarketId(marketId: string): Promise<string | undefined> {
        return this.dataSource
            .createQueryBuilder()
            .select("market.id", "id")
            .from("markets", "market")
            .where("market.id = :marketId", { marketId })
            .getRawOne();
    }

    async getEarliestMarketByAssetIds(
        assetIds: string[],
    ): Promise<{ assetId: string; marketId: string; maturity: Date }[]> {
        if (assetIds.length === 0) {
            return [];
        }
        const rows = await this.dataSource.query<
            {
                id: string;
                asset_id: string;
                maturity: Date | string;
            }[]
        >(
            `SELECT DISTINCT ON (asset_id) id, asset_id, maturity
             FROM markets
             WHERE asset_id = ANY($1::uuid[]) AND maturity >= NOW()
             ORDER BY asset_id, maturity ASC`,
            [assetIds],
        );
        return rows.map((row) => ({
            assetId: row.asset_id,
            marketId: row.id,
            maturity:
                row.maturity instanceof Date
                    ? row.maturity
                    : new Date(row.maturity),
        }));
    }

    async getSumDepositByAssetId(assetId: string): Promise<string> {
        const result = await this.dataSource
            .createQueryBuilder()
            .select("SUM(portfolio.amount)", "total_amount")
            .from("portfolio", "portfolio")
            .where("portfolio.asset_id = :assetId", { assetId })
            .getRawOne();
        return result?.total_amount || "0";
    }

    async getSumLoansByAssetId(assetId: string): Promise<string> {
        const result = await this.dataSource
            .createQueryBuilder()
            .select("SUM(lend_positions.amount)", "total_amount")
            .from("lend_positions", "lend_positions")
            .where("lend_positions.asset_id = :assetId", { assetId })
            .getRawOne();
        return result?.total_amount || "0";
    }

    async getUpcomingMarkets(
        assetId: string,
        limit: number,
    ): Promise<Market[]> {
        return this.createQueryBuilder("market")
            .where("market.asset_id = :assetId", { assetId })
            .andWhere("market.maturity > :now", { now: new Date() })
            .orderBy("market.maturity", "ASC")
            .take(limit)
            .getMany();
    }
}
