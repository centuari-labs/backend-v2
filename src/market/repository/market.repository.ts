import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, In, Repository } from "typeorm";
import { BYTEA_HEX } from "../../common/transformers/bytea-hex.transformer";
import { LendPosition } from "../../portfolio/entities/lend-position.entity";
import { UserBalance } from "../../portfolio/entities/user-balance.entity";
import { Token } from "../../tokens/entities/token.entity";
import { Market } from "../entities/market.entity";
import { computeMarketIdBytes32 } from "../utils/market-id.utils";

/**
 * MarketRepository — reads + eager-writes the shared `market` table
 * (BYTEA-keyed; written by indexer-v3 from `Centuari.MarketCreated` and
 * eager-written by `ensureMarketsForLoanToken` for new maturities).
 *
 * Class kept named `MarketRepositories` (typo'd plural) for compat with
 * existing injection sites; rename in a follow-up PR if desired.
 */
@Injectable()
export class MarketRepositories extends Repository<Market> {
    constructor(
        private dataSource: DataSource,
        @InjectRepository(UserBalance)
        private readonly userBalanceRepo: Repository<UserBalance>,
        @InjectRepository(LendPosition)
        private readonly lendRepo: Repository<LendPosition>,
    ) {
        super(Market, dataSource.createEntityManager());
    }

    async getMarketsByIds(marketIds: `0x${string}`[]): Promise<
        {
            id: `0x${string}`;
            assetId: string;
            maturity: number;
            loanToken: `0x${string}`;
        }[]
    > {
        if (marketIds.length === 0) return [];
        const byteaIds = marketIds.map((id) => BYTEA_HEX.to(id));
        const rows = await this.createQueryBuilder("m")
            .innerJoin(
                Token,
                "t",
                "LOWER(t.token_address) = '0x' || encode(m.loan_token, 'hex')",
            )
            .select("m.market_id", "market_id")
            .addSelect("m.loan_token", "loan_token")
            .addSelect("t.id", "asset_id")
            .addSelect("m.maturity", "maturity")
            .where("m.market_id IN (:...byteaIds)", { byteaIds })
            .getRawMany<{
                market_id: Buffer;
                loan_token: Buffer;
                asset_id: string;
                maturity: string;
            }>();
        return rows.map((row) => ({
            id: `0x${row.market_id.toString("hex")}` as `0x${string}`,
            assetId: row.asset_id,
            maturity: Number(row.maturity),
            loanToken: `0x${row.loan_token.toString("hex")}` as `0x${string}`,
        }));
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

    /**
     * For each input assetId, returns the earliest market with
     * `maturity >= minMaturity`. Joins to `assets` (Token) to surface the
     * UUID assetId callers expect. MarketIds are emitted as bytes32 hex
     * (the indexer-v3 schema's native representation).
     */
    async getEarliestMarketByAssetIds(
        assetIds: string[],
        minMaturity: Date = new Date(),
    ): Promise<{ assetId: string; marketId: `0x${string}`; maturity: Date }[]> {
        if (assetIds.length === 0) return [];
        const minMaturityUnix = Math.floor(minMaturity.getTime() / 1000);
        const rows = await this.createQueryBuilder("m")
            .innerJoin(
                Token,
                "t",
                "LOWER(t.token_address) = '0x' || encode(m.loan_token, 'hex')",
            )
            .distinctOn(["m.loan_token"])
            .select("t.id", "asset_id")
            .addSelect("m.market_id", "market_id")
            .addSelect("m.maturity", "maturity")
            .where("t.id IN (:...assetIds)", { assetIds })
            .andWhere("m.maturity >= :min", { min: minMaturityUnix.toString() })
            .orderBy("m.loan_token", "ASC")
            .addOrderBy("m.maturity", "ASC")
            .getRawMany<{
                asset_id: string;
                market_id: Buffer;
                maturity: string;
            }>();
        return rows.map((row) => ({
            assetId: row.asset_id,
            marketId: `0x${row.market_id.toString("hex")}` as `0x${string}`,
            maturity: new Date(Number(row.maturity) * 1000),
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

    /**
     * Resolves a marketId (hex) to its (assetId, decimals, tokenAddress,
     * maturity) tuple via a `market → assets` join. Consumed by repay +
     * withdrawLendPosition flows. Maturity emitted as ISO string for
     * `new Date(market.maturity)` compatibility.
     */
    async getMarketWithAsset(marketId: `0x${string}`): Promise<{
        id: `0x${string}`;
        assetId: string;
        maturity: string;
        decimals: number;
        tokenAddress: string;
    } | null> {
        const row = await this.createQueryBuilder("m")
            .innerJoin(
                Token,
                "t",
                "LOWER(t.token_address) = '0x' || encode(m.loan_token, 'hex')",
            )
            .select("m.maturity", "maturity")
            .addSelect("t.id", "asset_id")
            .addSelect("COALESCE(t.decimals, 0)", "decimals")
            .addSelect("t.token_address", "token_address")
            .where("m.market_id = :marketId", {
                marketId: BYTEA_HEX.to(marketId),
            })
            .getRawOne<{
                maturity: string;
                asset_id: string;
                decimals: number;
                token_address: string;
            }>();
        if (!row) return null;
        return {
            id: marketId,
            assetId: row.asset_id,
            maturity: new Date(Number(row.maturity) * 1000).toISOString(),
            decimals: Number(row.decimals),
            tokenAddress: row.token_address,
        };
    }

    /**
     * Lists upcoming (maturity > now) markets for a single assetId, earliest
     * first. MarketIds emitted as bytes32 hex.
     */
    async getUpcomingMarkets(
        assetId: string,
        limit: number,
    ): Promise<{ id: `0x${string}`; assetId: string; maturity: Date }[]> {
        const nowUnix = Math.floor(Date.now() / 1000);
        const rows = await this.createQueryBuilder("m")
            .innerJoin(
                Token,
                "t",
                "LOWER(t.token_address) = '0x' || encode(m.loan_token, 'hex')",
            )
            .select("m.market_id", "market_id")
            .addSelect("t.id", "asset_id")
            .addSelect("m.maturity", "maturity")
            .where("t.id = :assetId", { assetId })
            .andWhere("m.maturity > :now", { now: nowUnix.toString() })
            .orderBy("m.maturity", "ASC")
            .limit(limit)
            .getRawMany<{
                market_id: Buffer;
                asset_id: string;
                maturity: string;
            }>();
        return rows.map((row) => ({
            id: `0x${row.market_id.toString("hex")}` as `0x${string}`,
            assetId: row.asset_id,
            maturity: new Date(Number(row.maturity) * 1000),
        }));
    }

    /**
     * Returns every market keyed by `assetId` for the OrdersWorker cache
     * refresh (post-MarketWorker retirement). MarketIds emitted as hex.
     */
    async findAllMarketsForCache(): Promise<
        {
            assetId: string;
            marketId: `0x${string}`;
            loanToken: `0x${string}`;
            maturity: number;
        }[]
    > {
        const rows = await this.createQueryBuilder("m")
            .innerJoin(
                Token,
                "t",
                "LOWER(t.token_address) = '0x' || encode(m.loan_token, 'hex')",
            )
            .select("t.id", "asset_id")
            .addSelect("m.market_id", "market_id")
            .addSelect("m.loan_token", "loan_token")
            .addSelect("m.maturity", "maturity")
            .orderBy("t.id", "ASC")
            .addOrderBy("m.maturity", "ASC")
            .getRawMany<{
                asset_id: string;
                market_id: Buffer;
                loan_token: Buffer;
                maturity: string;
            }>();
        return rows.map((row) => ({
            assetId: row.asset_id,
            marketId: `0x${row.market_id.toString("hex")}` as `0x${string}`,
            loanToken: `0x${row.loan_token.toString("hex")}` as `0x${string}`,
            maturity: Number(row.maturity),
        }));
    }

    /**
     * Eager-write new markets into the shared `market` table so they are
     * orderable before any on-chain `Centuari.MarketCreated` event fires
     * (the contract only emits that on a market's first settlement; see
     * [Centuari.sol:81-102]). Mirrors the C3 "backend writes first, indexer
     * tail-writes with stamps" pattern: `applied_by_*` columns stay NULL
     * until indexer-v3 catches up on first settlement, after which its
     * `ON CONFLICT (market_id) DO NOTHING` clause makes the tail-write a
     * safe no-op.
     *
     * MarketId encoding: `uuidToBytes32(legacyUuid)` — calldata-verbatim
     * invariant from [Centuari.sol:81-102]. Do NOT change to full-width
     * keccak256 without migrating every existing row in `market`,
     * `order_markets`, `matches`, `lend_position`, `borrow_position`, and
     * `pending_collateral_flags` (see C4 plan §Phase 2 §A).
     */
    async ensureMarketsForLoanToken(
        loanTokenAddr: string,
        maturityUnixSeconds: number[],
    ): Promise<
        {
            marketId: `0x${string}`;
            loanToken: `0x${string}`;
            maturity: number;
        }[]
    > {
        if (maturityUnixSeconds.length === 0) return [];
        const loanToken = loanTokenAddr.toLowerCase() as `0x${string}`;
        const triples = maturityUnixSeconds.map((m) => ({
            marketId: computeMarketIdBytes32(loanToken, m),
            loanToken,
            maturity: m,
        }));
        await this.createQueryBuilder()
            .insert()
            .into(Market)
            .values(
                triples.map((t) => ({
                    marketId: t.marketId,
                    loanToken: t.loanToken,
                    maturity: t.maturity.toString(),
                })),
            )
            .orIgnore()
            .execute();
        return triples;
    }
}
