import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, In, Repository } from "typeorm";
import { LendPosition } from "../../portfolio/entities/lend-position.entity";
import { UserBalance } from "../../portfolio/entities/user-balance.entity";
import { Token } from "../../tokens/entities/token.entity";
import { LegacyMarket } from "../entities/legacy-market.entity";
import { Market } from "../entities/market.entity";

@Injectable()
export class MarketRepositories extends Repository<LegacyMarket> {
    constructor(
        private dataSource: DataSource,
        @InjectRepository(UserBalance)
        private readonly userBalanceRepo: Repository<UserBalance>,
        @InjectRepository(LendPosition)
        private readonly lendRepo: Repository<LendPosition>,
    ) {
        super(LegacyMarket, dataSource.createEntityManager());
    }

    async getMarketsByIds(marketIds: string[]): Promise<LegacyMarket[]> {
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
        return this.userBalanceRepo
            .createQueryBuilder("ub")
            .innerJoin(
                Token,
                "t",
                "LOWER(t.token_address) = '0x' || encode(ub.asset, 'hex')",
            )
            .select("t.id", "asset_id")
            .addSelect(
                "SUM(ub.available + ub.in_orders + ub.in_yield_router)::text",
                "total_amount",
            )
            .groupBy("t.id")
            .getRawMany();
    }

    async getActiveLoans(): Promise<
        { asset_id: string; total_amount: string }[]
    > {
        return this.lendRepo
            .createQueryBuilder("lp")
            .innerJoin(Market, "m", "m.market_id = lp.market_id")
            .innerJoin(
                Token,
                "t",
                "LOWER(t.token_address) = '0x' || encode(m.loan_token, 'hex')",
            )
            .select("t.id", "asset_id")
            .addSelect("SUM(lp.principal)::text", "total_amount")
            .where("lp.cbt_balance > 0")
            .groupBy("t.id")
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
        minMaturity: Date = new Date(),
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
             WHERE asset_id = ANY($1::uuid[]) AND maturity >= $2
             ORDER BY asset_id, maturity ASC`,
            [assetIds, minMaturity],
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
        const result = await this.userBalanceRepo
            .createQueryBuilder("ub")
            .innerJoin(
                Token,
                "t",
                "LOWER(t.token_address) = '0x' || encode(ub.asset, 'hex')",
            )
            .select(
                "COALESCE(SUM(ub.available + ub.in_orders + ub.in_yield_router), 0)::text",
                "total_amount",
            )
            .where("t.id = :assetId", { assetId })
            .getRawOne();
        return result?.total_amount || "0";
    }

    async getSumLoansByAssetId(assetId: string): Promise<string> {
        const result = await this.lendRepo
            .createQueryBuilder("lp")
            .innerJoin(Market, "m", "m.market_id = lp.market_id")
            .innerJoin(
                Token,
                "t",
                "LOWER(t.token_address) = '0x' || encode(m.loan_token, 'hex')",
            )
            .select("COALESCE(SUM(lp.principal), 0)::text", "total_amount")
            .where("t.id = :assetId", { assetId })
            .andWhere("lp.cbt_balance > 0")
            .getRawOne();
        return result?.total_amount || "0";
    }

    async getMarketWithAsset(marketId: string): Promise<{
        id: string;
        assetId: string;
        maturity: string;
        decimals: number;
        tokenAddress: string;
    } | null> {
        const rows = await this.dataSource.query(
            `SELECT m.id, m.asset_id as "assetId", m.maturity,
                    COALESCE(a.decimals, 0) as decimals,
                    a.token_address as "tokenAddress"
             FROM markets m
             JOIN assets a ON m.asset_id = a.id
             WHERE m.id = $1`,
            [marketId],
        );
        return rows[0] || null;
    }

    async getUpcomingMarkets(
        assetId: string,
        limit: number,
    ): Promise<LegacyMarket[]> {
        return this.createQueryBuilder("market")
            .where("market.asset_id = :assetId", { assetId })
            .andWhere("market.maturity > :now", { now: new Date() })
            .orderBy("market.maturity", "ASC")
            .take(limit)
            .getMany();
    }
}
