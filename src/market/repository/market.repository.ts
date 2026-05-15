import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { BYTEA_HEX } from "../../common/transformers/bytea-hex.transformer";
import {
    bytes32ToUuid,
    uuidToBytes32,
} from "../../common/utils/uuid.utils";
import { LendPosition } from "../../portfolio/entities/lend-position.entity";
import { UserBalance } from "../../portfolio/entities/user-balance.entity";
import { Token } from "../../tokens/entities/token.entity";
import { LegacyMarket } from "../entities/legacy-market.entity";
import { Market } from "../entities/market.entity";
import { computeMarketId as computeLegacyMarketUuid } from "../utils/market-id.utils";

@Injectable()
export class MarketRepositories extends Repository<LegacyMarket> {
    constructor(
        private dataSource: DataSource,
        @InjectRepository(UserBalance)
        private readonly userBalanceRepo: Repository<UserBalance>,
        @InjectRepository(LendPosition)
        private readonly lendRepo: Repository<LendPosition>,
        @InjectRepository(Market)
        private readonly marketRepo: Repository<Market>,
    ) {
        super(LegacyMarket, dataSource.createEntityManager());
    }

    // Reads from the new BYTEA-keyed `market` table; takes UUID input and
    // returns LegacyMarket-shaped objects (id UUID, assetId, maturity Date,
    // createdAt) for backward compat with existing callers (e.g.
    // OrdersService.resolveMarketMaturities). The `asset` relation is left
    // unset — no caller of this method consumes it today.
    async getMarketsByIds(marketIds: string[]): Promise<LegacyMarket[]> {
        if (marketIds.length === 0) return [];
        const byteaIds = marketIds.map((id) => BYTEA_HEX.to(uuidToBytes32(id)));
        const rows = await this.marketRepo
            .createQueryBuilder("m")
            .innerJoin(
                Token,
                "t",
                "LOWER(t.token_address) = '0x' || encode(m.loan_token, 'hex')",
            )
            .select("m.market_id", "market_id")
            .addSelect("t.id", "asset_id")
            .addSelect("m.maturity", "maturity")
            .addSelect("m.created_at", "created_at")
            .where("m.market_id IN (:...byteaIds)", { byteaIds })
            .getRawMany<{
                market_id: Buffer;
                asset_id: string;
                maturity: string;
                created_at: Date;
            }>();
        return rows.map((row) => {
            const m = new LegacyMarket();
            m.id = bytes32ToUuid(`0x${row.market_id.toString("hex")}`);
            m.assetId = row.asset_id;
            m.maturity = new Date(Number(row.maturity) * 1000);
            m.createdAt = row.created_at;
            return m;
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

    // Reads from the new BYTEA-keyed `market` table. For each input assetId,
    // returns the earliest market with `maturity >= minMaturity`. Joins to
    // `assets` (Token) to surface the UUID assetId callers expect.
    async getEarliestMarketByAssetIds(
        assetIds: string[],
        minMaturity: Date = new Date(),
    ): Promise<{ assetId: string; marketId: string; maturity: Date }[]> {
        if (assetIds.length === 0) return [];
        const minMaturityUnix = Math.floor(minMaturity.getTime() / 1000);
        const rows = await this.marketRepo
            .createQueryBuilder("m")
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
            marketId: bytes32ToUuid(`0x${row.market_id.toString("hex")}`),
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

    // Reads from the new BYTEA-keyed `market` table. Takes UUID input;
    // returns the (id, assetId, maturity, decimals, tokenAddress) tuple
    // PortfolioService.withdrawLendPosition and RepayService expect. Maturity
    // is emitted as an ISO date string for backward compat — callers do
    // `new Date(market.maturity)` and expect a parseable string.
    async getMarketWithAsset(marketId: string): Promise<{
        id: string;
        assetId: string;
        maturity: string;
        decimals: number;
        tokenAddress: string;
    } | null> {
        const row = await this.marketRepo
            .createQueryBuilder("m")
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
                marketId: BYTEA_HEX.to(uuidToBytes32(marketId)),
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

    // Reads from the new BYTEA-keyed `market` table. Returns LegacyMarket-
    // shaped rows for a single assetId. Callers consume `.id` (UUID) and
    // `.maturity` (Date — `new Date(m.maturity).getTime()`).
    async getUpcomingMarkets(
        assetId: string,
        limit: number,
    ): Promise<LegacyMarket[]> {
        const nowUnix = Math.floor(Date.now() / 1000);
        const rows = await this.marketRepo
            .createQueryBuilder("m")
            .innerJoin(
                Token,
                "t",
                "LOWER(t.token_address) = '0x' || encode(m.loan_token, 'hex')",
            )
            .select("m.market_id", "market_id")
            .addSelect("t.id", "asset_id")
            .addSelect("m.maturity", "maturity")
            .addSelect("m.created_at", "created_at")
            .where("t.id = :assetId", { assetId })
            .andWhere("m.maturity > :now", { now: nowUnix.toString() })
            .orderBy("m.maturity", "ASC")
            .limit(limit)
            .getRawMany<{
                market_id: Buffer;
                asset_id: string;
                maturity: string;
                created_at: Date;
            }>();
        return rows.map((row) => {
            const m = new LegacyMarket();
            m.id = bytes32ToUuid(`0x${row.market_id.toString("hex")}`);
            m.assetId = row.asset_id;
            m.maturity = new Date(Number(row.maturity) * 1000);
            m.createdAt = row.created_at;
            return m;
        });
    }

    // Eager-write new markets into the shared `market` table so they are
    // orderable before any on-chain `Centuari.MarketCreated` event fires
    // (the contract only emits that on a market's first settlement; see
    // [Centuari.sol:81-102]). Mirrors the C3 "backend writes first, indexer
    // tail-writes with stamps" pattern: `applied_by_*` columns stay NULL
    // until indexer-v3 catches up on first settlement, after which its
    // `ON CONFLICT (market_id) DO NOTHING` clause makes the tail-write a
    // safe no-op.
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
            marketId: this.computeMarketId(loanToken, m),
            loanToken,
            maturity: m,
        }));
        await this.marketRepo
            .createQueryBuilder()
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

    // Deterministic marketId for a (loanToken, maturity) pair.
    //
    // Encoding: `uuidToBytes32(first 16 bytes of keccak256(abi.encode(loanToken,
    // maturity)) formatted as UUID)`. This is the calldata-verbatim value
    // `Centuari.settleMatch` re-emits via `MarketCreated` today (see
    // [Centuari.sol:81-102, 295]). Do NOT change to full-width keccak256
    // without migrating every existing row in `market`, `order_markets`,
    // `matches`, `lend_position`, `borrow_position`, and
    // `pending_collateral_flags` — see C4 plan §Phase 2 §A.
    private computeMarketId(
        loanTokenAddr: string,
        maturityUnixSeconds: number,
    ): `0x${string}` {
        return uuidToBytes32(
            computeLegacyMarketUuid(loanTokenAddr, maturityUnixSeconds),
        );
    }
}
