import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, In, Repository } from "typeorm";
import { BYTEA_HEX } from "../../common/transformers/bytea-hex.transformer";
import { OrderSide, OrderStatus } from "../../orders/constants/order.constants";
import { Token } from "../../tokens/entities/token.entity";
import { Market } from "../../market/entities/market.entity";
import type { RawOpenOrderRow } from "../dto/open-orders.dto";
import { Account } from "../../orders/entities/account.entity";
import { BorrowPosition } from "../entities/borrow-position.entity";
import { LendPosition } from "../entities/lend-position.entity";
import { UserBalance } from "../entities/user-balance.entity";

export interface RawPosition {
    position_id: string;
    market_id: string;
    asset_id: string;
    side: OrderSide;
    rate: string;
    quantity: string;
    base_amount: string;
    status: OrderStatus;
    symbol: string;
    name: string;
    token_address: string;
    image_url: string | null;
    decimals: number;
    maturity: Date | null;
    created_at: Date;
}

export interface RawOrderHistoryRow {
    id: string;
    side: string;
    order_type: string | null;
    rate: string;
    amount: string;
    filled_quantity: string | null;
    status: string;
    cancel_reason: string | null;
    asset_id: string;
    name: string;
    symbol: string;
    image_url: string | null;
    decimals: string;
    token_address: string;
    maturity: string | null;
    total_fee: string;
    created_at: string;
}

export interface RawTransactionHistoryRow {
    id: string;
    match_amount: string;
    rate: string;
    maturity: string;
    created_at: string;
    lender_account_id: string;
    borrower_account_id: string;
    maker_fee: string;
    taker_fee: string;
    lender_settlement_fee: string;
    borrower_settlement_fee: string;
    asset_id: string;
    name: string;
    symbol: string;
    image_url: string | null;
    decimals: string;
    token_address: string;
}

export interface LendPositionForApr {
    asset_id: string;
    shares: string;
    original_shares: string;
    amount: string;
    apr: string;
    created_at: Date;
}

@Injectable()
export class PortfolioRepository extends Repository<UserBalance> {
    constructor(
        private dataSource: DataSource,
        @InjectRepository(UserBalance)
        private readonly userBalanceRepo: Repository<UserBalance>,
        @InjectRepository(LendPosition)
        private readonly lendRepo: Repository<LendPosition>,
        @InjectRepository(BorrowPosition)
        private readonly borrowRepo: Repository<BorrowPosition>,
    ) {
        super(UserBalance, dataSource.createEntityManager());
    }

    /**
     * Resolves an account's shared-schema `user_balance` row for one asset,
     * bridging the backend's UUID `accountId`/`assetId` to the BYTEA-keyed
     * `user_balance` via the `accounts` wallet and `tokens` address. Returns
     * "0"/"0" when the user has no balance row for the asset.
     */
    async getAccountBalanceForAsset(
        accountId: string,
        assetId: string,
    ): Promise<{ available: string; inOrders: string }> {
        const row = await this.userBalanceRepo
            .createQueryBuilder("ub")
            .innerJoin(
                Account,
                "a",
                "LOWER(a.user_wallet) = '0x' || encode(ub.user_address, 'hex')",
            )
            .innerJoin(
                Token,
                "t",
                "LOWER(t.token_address) = '0x' || encode(ub.asset, 'hex')",
            )
            .select("ub.available::text", "available")
            .addSelect("ub.in_orders::text", "in_orders")
            .where("a.id = :accountId", { accountId })
            .andWhere("t.id = :assetId", { assetId })
            .getRawOne<{ available: string; in_orders: string }>();
        return {
            available: row?.available ?? "0",
            inOrders: row?.in_orders ?? "0",
        };
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

    /**
     * Returns the most-conservative borrow HF buffer (max basis points)
     * across the user's flagged collateral × the order's loan token. Caller
     * (PortfolioService) supplies the user's actual collateral set so the
     * buffer reflects the real exposure rather than a worst-case across all
     * possible pairs.
     *
     * Returns null when no `risk` row matches — callers default to
     * DEFAULT_BORROW_BUFFER_BPS (see health-factor.helpers.ts).
     */
    async getBorrowBufferBps(
        collateralTokenIds: string[],
        loanTokenId: string,
    ): Promise<number | null> {
        if (collateralTokenIds.length === 0) return null;
        const rows: { max_buffer: number | null }[] =
            await this.dataSource.query(
                `SELECT MAX(borrow_buffer_bps)::int AS max_buffer
                 FROM risk
                 WHERE loan_token_id = $1
                   AND collateral_token_id = ANY($2)`,
                [loanTokenId, collateralTokenIds],
            );
        const max = rows[0]?.max_buffer;
        return max != null ? Number(max) : null;
    }

    // ──────────────────────────────────────────────────────────────
    // Shared on-chain-state reads (A5)
    //
    // These methods query `user_balance`, `lend_position`,
    // `borrow_position`, `market` — the canonical tables every service
    // shares via the same Postgres. Mapped by normal TypeORM entities
    // (see `entities/user-balance.entity.ts` etc.); BYTEA columns use
    // the `BYTEA_HEX` transformer so hex strings round-trip cleanly.
    //
    // JOIN conditions that bridge bytea ↔ text (shared schema's bytea
    // columns vs backend `tokens.token_address` text) stay as raw
    // string fragments — TypeORM can't type-check across that boundary
    // on either side. Param values for raw-string `.where()` fragments
    // are wrapped with `BYTEA_HEX.to(...)` explicitly.
    // ──────────────────────────────────────────────────────────────

    async getUserBalances(wallet: string): Promise<
        {
            asset_id: string;
            symbol: string;
            name: string;
            image_url: string | null;
            decimals: number;
            amount: string;
            is_collateral: boolean;
        }[]
    > {
        return this.userBalanceRepo
            .createQueryBuilder("ub")
            .innerJoin(
                Token,
                "t",
                "LOWER(t.token_address) = '0x' || encode(ub.asset, 'hex')",
            )
            .select("t.id", "asset_id")
            .addSelect("t.symbol", "symbol")
            .addSelect("t.name", "name")
            .addSelect("t.image_url", "image_url")
            .addSelect("COALESCE(t.decimals, 0)", "decimals")
            .addSelect("ub.available::text", "amount")
            .addSelect("ub.used_as_collateral", "is_collateral")
            .where("ub.user_address = :u", { u: BYTEA_HEX.to(wallet) })
            .orderBy("t.symbol")
            .getRawMany();
    }

    async getUserBalanceForAsset(
        wallet: string,
        assetId: string,
    ): Promise<{
        available: string;
        isCollateral: boolean;
        decimals: number;
    } | null> {
        const row = await this.userBalanceRepo
            .createQueryBuilder("ub")
            .innerJoin(
                Token,
                "t",
                "LOWER(t.token_address) = '0x' || encode(ub.asset, 'hex')",
            )
            .select("ub.available::text", "available")
            .addSelect("ub.used_as_collateral", "is_collateral")
            .addSelect("COALESCE(t.decimals, 0)", "decimals")
            .where("ub.user_address = :w", { w: BYTEA_HEX.to(wallet) })
            .andWhere("t.id = :assetId", { assetId })
            .getRawOne();
        if (!row) return null;
        return {
            available: row.available,
            isCollateral: row.is_collateral,
            decimals: Number(row.decimals),
        };
    }

    async getUserSuppliedAssets(
        wallet: string,
    ): Promise<{ asset_id: string; amount: string; decimals: number }[]> {
        return this.lendRepo
            .createQueryBuilder("lp")
            .innerJoin(Market, "m", "m.market_id = lp.market_id")
            .innerJoin(
                Token,
                "t",
                "LOWER(t.token_address) = '0x' || encode(m.loan_token, 'hex')",
            )
            .select("t.id", "asset_id")
            .addSelect("COALESCE(SUM(lp.principal), 0)::text", "amount")
            .addSelect("COALESCE(t.decimals, 0)", "decimals")
            .where("lp.lender = :w", { w: BYTEA_HEX.to(wallet) })
            .andWhere("lp.cbt_balance > 0")
            .groupBy("t.id")
            .addGroupBy("t.decimals")
            .getRawMany();
    }

    async getUserBorrowedAssets(
        wallet: string,
    ): Promise<{ asset_id: string; amount: string; decimals: number }[]> {
        return this.borrowRepo
            .createQueryBuilder("bp")
            .innerJoin(Market, "m", "m.market_id = bp.market_id")
            .innerJoin(
                Token,
                "t",
                "LOWER(t.token_address) = '0x' || encode(m.loan_token, 'hex')",
            )
            .select("t.id", "asset_id")
            .addSelect("COALESCE(SUM(bp.debt), 0)::text", "amount")
            .addSelect("COALESCE(t.decimals, 0)", "decimals")
            .where("bp.borrower = :w", { w: BYTEA_HEX.to(wallet) })
            .andWhere("bp.debt > 0")
            .groupBy("t.id")
            .addGroupBy("t.decimals")
            .getRawMany();
    }

    async getUserLendPositionsForApr(wallet: string): Promise<
        {
            asset_id: string;
            amount: string;
            apr: string;
            decimals: number;
        }[]
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
            .addSelect("lp.principal::text", "amount")
            .addSelect("lp.rate::text", "apr")
            .addSelect("COALESCE(t.decimals, 0)", "decimals")
            .where("lp.lender = :w", { w: BYTEA_HEX.to(wallet) })
            .andWhere("lp.cbt_balance > 0")
            .getRawMany();
    }

    async getUserCollateralAssets(
        wallet: string,
    ): Promise<{ asset_id: string; amount: string; decimals: number }[]> {
        return this.userBalanceRepo
            .createQueryBuilder("ub")
            .innerJoin(
                Token,
                "t",
                "LOWER(t.token_address) = '0x' || encode(ub.asset, 'hex')",
            )
            .select("t.id", "asset_id")
            .addSelect("ub.available::text", "amount")
            .addSelect("COALESCE(t.decimals, 0)", "decimals")
            .where("ub.user_address = :w", { w: BYTEA_HEX.to(wallet) })
            .andWhere("ub.used_as_collateral = true")
            .andWhere("ub.available > 0")
            .getRawMany();
    }

    async getUserAssets(
        wallet: string,
        page = 1,
        limit = 10,
    ): Promise<{
        data: {
            asset_id: string;
            token_address: string;
            symbol: string;
            name: string;
            image_url: string | null;
            decimals: number;
            amount: string;
            is_collateral: boolean;
            pending_collateral_flag: boolean;
            flagged_at: string;
        }[];
        total: number;
    }> {
        const offset = (page - 1) * limit;
        const rows = await this.userBalanceRepo
            .createQueryBuilder("ub")
            .innerJoin(
                Token,
                "t",
                "LOWER(t.token_address) = '0x' || encode(ub.asset, 'hex')",
            )
            .leftJoin(
                "pending_collateral_flags",
                "pcf",
                "pcf.user_address = ub.user_address AND pcf.asset = ub.asset",
            )
            .select("t.id", "asset_id")
            .addSelect("LOWER(t.token_address)", "token_address")
            .addSelect("t.symbol", "symbol")
            .addSelect("t.name", "name")
            .addSelect("t.image_url", "image_url")
            .addSelect("COALESCE(t.decimals, 0)", "decimals")
            .addSelect("ub.available::text", "amount")
            .addSelect("ub.used_as_collateral", "is_collateral")
            .addSelect("ub.flagged_at::text", "flagged_at")
            .addSelect(
                "pcf.user_address IS NOT NULL",
                "pending_collateral_flag",
            )
            .addSelect("COUNT(*) OVER ()", "total_count")
            .where("ub.user_address = :w", { w: BYTEA_HEX.to(wallet) })
            .andWhere("ub.available > 0")
            .orderBy("t.symbol")
            .limit(limit)
            .offset(offset)
            .getRawMany<{
                asset_id: string;
                token_address: string;
                symbol: string;
                name: string;
                image_url: string | null;
                decimals: number;
                amount: string;
                is_collateral: boolean;
                pending_collateral_flag: boolean;
                flagged_at: string;
                total_count: string;
            }>();

        const total = rows[0]?.total_count ? Number(rows[0].total_count) : 0;
        // Drop the per-row `total_count` from the caller-facing shape.
        const data = rows.map(({ total_count: _drop, ...row }) => row);
        return { data, total };
    }

    async getUserPositions(
        wallet: string,
        positionType?: "LEND" | "BORROW",
        page = 1,
        limit = 10,
        assetId?: string,
    ): Promise<{ data: RawPosition[]; total: number }> {
        const includeLend = !positionType || positionType === "LEND";
        const includeBorrow = !positionType || positionType === "BORROW";
        const walletBuf = BYTEA_HEX.to(wallet);

        const lendRows: RawPosition[] = includeLend
            ? await this.lendRepo
                  .createQueryBuilder("lp")
                  .innerJoin(Market, "m", "m.market_id = lp.market_id")
                  .innerJoin(
                      Token,
                      "t",
                      "LOWER(t.token_address) = '0x' || encode(m.loan_token, 'hex')",
                  )
                  .select("encode(lp.market_id, 'hex')", "market_id")
                  .addSelect("encode(lp.market_id, 'hex')", "position_id")
                  .addSelect("t.id", "asset_id")
                  .addSelect("'LEND'", "side")
                  .addSelect("lp.rate::text", "rate")
                  .addSelect("lp.cbt_balance::text", "quantity")
                  .addSelect("lp.principal::text", "base_amount")
                  .addSelect("t.symbol", "symbol")
                  .addSelect("t.name", "name")
                  .addSelect("t.token_address", "token_address")
                  .addSelect("t.image_url", "image_url")
                  .addSelect("COALESCE(t.decimals, 0)", "decimals")
                  .addSelect("to_timestamp(m.maturity)", "maturity")
                  .addSelect("lp.updated_at", "created_at")
                  .addSelect("'OPEN'", "status")
                  .where("lp.lender = :w", { w: walletBuf })
                  .andWhere("lp.cbt_balance > 0")
                  .andWhere(
                      "(CAST(:assetId AS uuid) IS NULL OR t.id = :assetId)",
                      {
                          assetId: assetId ?? null,
                      },
                  )
                  .getRawMany()
            : [];

        const borrowRows: RawPosition[] = includeBorrow
            ? await this.borrowRepo
                  .createQueryBuilder("bp")
                  .innerJoin(Market, "m", "m.market_id = bp.market_id")
                  .innerJoin(
                      Token,
                      "t",
                      "LOWER(t.token_address) = '0x' || encode(m.loan_token, 'hex')",
                  )
                  .select("encode(bp.market_id, 'hex')", "market_id")
                  .addSelect("encode(bp.market_id, 'hex')", "position_id")
                  .addSelect("t.id", "asset_id")
                  .addSelect("'BORROW'", "side")
                  .addSelect("bp.rate::text", "rate")
                  .addSelect("bp.debt::text", "quantity")
                  .addSelect("bp.principal::text", "base_amount")
                  .addSelect("t.symbol", "symbol")
                  .addSelect("t.name", "name")
                  .addSelect("t.token_address", "token_address")
                  .addSelect("t.image_url", "image_url")
                  .addSelect("COALESCE(t.decimals, 0)", "decimals")
                  .addSelect("to_timestamp(m.maturity)", "maturity")
                  .addSelect("bp.updated_at", "created_at")
                  .addSelect("'OPEN'", "status")
                  .where("bp.borrower = :w", { w: walletBuf })
                  .andWhere("bp.debt > 0")
                  .andWhere(
                      "(CAST(:assetId AS uuid) IS NULL OR t.id = :assetId)",
                      {
                          assetId: assetId ?? null,
                      },
                  )
                  .getRawMany()
            : [];

        const combined = [...lendRows, ...borrowRows].sort(
            (a, b) =>
                new Date(b.created_at).getTime() -
                new Date(a.created_at).getTime(),
        );
        const total = combined.length;
        const offset = (page - 1) * limit;
        const data = combined.slice(offset, offset + limit);
        return { data, total };
    }

    async getLendPosition(
        marketIdHex: string,
        lender: string,
    ): Promise<{ cbt_balance: string; principal: string } | null> {
        const row = await this.lendRepo.findOne({
            where: { marketId: marketIdHex, lender },
            select: { cbtBalance: true, principal: true },
        });
        return row
            ? { cbt_balance: row.cbtBalance, principal: row.principal }
            : null;
    }

    async getBorrowPosition(
        marketIdHex: string,
        borrower: string,
    ): Promise<{ principal: string; debt: string } | null> {
        const row = await this.borrowRepo.findOne({
            where: { marketId: marketIdHex, borrower },
            select: { principal: true, debt: true },
        });
        return row ? { principal: row.principal, debt: row.debt } : null;
    }

    // End shared on-chain-state reads ────────────────────────────────

    async getUserDailyLendBorrow(
        accountId: string,
        days: number,
    ): Promise<
        {
            date: string;
            asset_id: string;
            decimals: number;
            lend_amount: string;
            borrow_amount: string;
        }[]
    > {
        const query = `
            SELECT
                combined.date,
                combined.asset_id,
                a.decimals,
                COALESCE(combined.lend_amount, 0) as lend_amount,
                COALESCE(combined.borrow_amount, 0) as borrow_amount
            FROM (
                SELECT DATE(m.created_at) as date, m.asset_id,
                    SUM(CASE WHEN m.lender_account_id = $1 THEN m.match_amount ELSE 0 END) as lend_amount,
                    SUM(CASE WHEN m.borrower_account_id = $1 THEN m.match_amount ELSE 0 END) as borrow_amount
                FROM matches m
                WHERE (m.lender_account_id = $1 OR m.borrower_account_id = $1)
                AND m.created_at >= CURRENT_DATE - ($2 || ' days')::interval
                GROUP BY DATE(m.created_at), m.asset_id
            ) combined
            JOIN assets a ON a.id = combined.asset_id
            ORDER BY combined.date ASC
        `;

        return this.dataSource.query(query, [accountId, days]);
    }

    async getOrderHistory(
        accountId: string,
        page: number,
        limit: number,
        filters?: {
            assetId?: string;
            side?: string;
            status?: string;
            startDate?: string;
            endDate?: string;
            maturity?: string;
        },
    ): Promise<{ data: RawOrderHistoryRow[]; total: number }> {
        const offset = (page - 1) * limit;
        const params: any[] = [accountId];
        let paramIndex = 2;

        let whereClause = "WHERE o.account_id = $1";

        if (filters?.assetId) {
            whereClause += ` AND o.asset_id = $${paramIndex}`;
            params.push(filters.assetId);
            paramIndex++;
        }

        if (filters?.side) {
            whereClause += ` AND o.side = $${paramIndex}`;
            params.push(filters.side);
            paramIndex++;
        }

        if (filters?.status) {
            whereClause += ` AND o.status = $${paramIndex}`;
            params.push(filters.status);
            paramIndex++;
        }

        if (filters?.startDate) {
            whereClause += ` AND o.created_at >= $${paramIndex}`;
            params.push(filters.startDate);
            paramIndex++;
        }

        if (filters?.endDate) {
            whereClause += ` AND o.created_at <= $${paramIndex}`;
            params.push(filters.endDate);
            paramIndex++;
        }

        if (filters?.maturity) {
            whereClause += ` AND EXISTS (
                SELECT 1 FROM order_markets om_filter 
                JOIN market m_filter ON m_filter.market_id = om_filter.market_id 
                WHERE om_filter.order_id = o.id AND m_filter.maturity = $${paramIndex}
            )`;
            params.push(filters.maturity);
            paramIndex++;
        }

        const dataQuery = `
            SELECT o.id, o.side::text, o.type::text as order_type, o.rate,
                   o.quantity as amount, o.filled_quantity, o.status::text,
                   o.cancel_reason::text,
                   a.id as asset_id, a.name, a.symbol, a.image_url,
                   COALESCE(a.decimals, 0) as decimals, a.token_address,
                   (
                       SELECT m.maturity
                       FROM order_markets om
                       JOIN market m ON m.market_id = om.market_id
                       WHERE om.order_id = o.id
                       ORDER BY m.maturity DESC
                       LIMIT 1
                   ) as maturity,
                   mf.total_fee,
                   o.created_at
            FROM orders o
            JOIN assets a ON o.asset_id = a.id
            LEFT JOIN LATERAL (
                SELECT COALESCE(SUM(
                    CASE WHEN mt.lend_order_market_id = o.id
                         THEN COALESCE(mt.maker_fee, 0) + COALESCE(mt.taker_fee, 0) + COALESCE(mt.lender_settlement_fee, 0)
                         ELSE COALESCE(mt.maker_fee, 0) + COALESCE(mt.taker_fee, 0) + COALESCE(mt.borrower_settlement_fee, 0)
                    END
                ), 0) as total_fee
                FROM matches mt
                WHERE mt.lend_order_market_id = o.id OR mt.borrow_order_market_id = o.id
            ) mf ON true
            ${whereClause}
            ORDER BY o.created_at DESC
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;
        params.push(limit, offset);

        const countQuery = `
            SELECT COUNT(*) as count
            FROM orders o
            ${whereClause}
        `;

        const [rows, countResult] = await Promise.all([
            this.dataSource.query(dataQuery, params),
            this.dataSource.query(countQuery, params.slice(0, paramIndex - 1)),
        ]);

        return {
            data: rows,
            total: Number.parseInt(countResult[0]?.count || "0", 10),
        };
    }

    async getOpenOrders(
        accountId: string,
        page: number,
        limit: number,
        filters: {
            side?: string;
            status?: string;
            startDate?: string;
            endDate?: string;
            assetId?: string;
        },
    ): Promise<{ data: RawOpenOrderRow[]; total: number }> {
        const offset = (page - 1) * limit;
        const params: any[] = [accountId];
        let paramIndex = 2;

        let whereClause = "WHERE o.account_id = $1";

        if (filters.status) {
            whereClause += ` AND o.status = $${paramIndex}`;
            params.push(filters.status);
            paramIndex++;
        } else {
            whereClause += ` AND o.status IN ('OPEN', 'PARTIALLY_FILLED')`;
        }

        if (filters.side) {
            whereClause += ` AND o.side = $${paramIndex}`;
            params.push(filters.side);
            paramIndex++;
        }

        if (filters.startDate) {
            whereClause += ` AND o.created_at >= $${paramIndex}`;
            params.push(filters.startDate);
            paramIndex++;
        }

        if (filters.endDate) {
            whereClause += ` AND o.created_at <= $${paramIndex}`;
            params.push(filters.endDate);
            paramIndex++;
        }

        if (filters.assetId) {
            whereClause += ` AND o.asset_id = $${paramIndex}`;
            params.push(filters.assetId);
            paramIndex++;
        }

        const dataQuery = `
            SELECT o.id, o.side::text, o.type::text as order_type, o.rate,
                   o.quantity as amount, o.filled_quantity, o.status::text,
                   o.cancel_reason::text,
                   a.id as asset_id, a.name, a.symbol, a.image_url,
                   COALESCE(a.decimals, 0) as decimals, a.token_address,
                   m.maturity,
                   o.created_at
            FROM orders o
            JOIN assets a ON o.asset_id = a.id
            LEFT JOIN order_markets om ON om.order_id = o.id
            LEFT JOIN market m ON m.market_id = om.market_id
            ${whereClause}
            ORDER BY o.created_at DESC
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;
        params.push(limit, offset);

        const countQuery = `
            SELECT COUNT(*) as count
            FROM orders o
            ${whereClause}
        `;

        const [rows, countResult] = await Promise.all([
            this.dataSource.query(dataQuery, params),
            this.dataSource.query(countQuery, params.slice(0, paramIndex - 1)),
        ]);

        return {
            data: rows,
            total: Number.parseInt(countResult[0]?.count || "0", 10),
        };
    }

    async getTransactionHistory(
        accountId: string,
        page: number,
        limit: number,
        filters?: {
            assetId?: string;
            side?: string;
            startDate?: string;
            endDate?: string;
        },
    ): Promise<{ data: RawTransactionHistoryRow[]; total: number }> {
        const offset = (page - 1) * limit;
        const params: any[] = [accountId];
        let paramIndex = 2;

        let whereClause =
            "WHERE (m.lender_account_id = $1 OR m.borrower_account_id = $1)";

        if (filters?.side === "LEND") {
            whereClause = "WHERE m.lender_account_id = $1";
        } else if (filters?.side === "BORROW") {
            whereClause = "WHERE m.borrower_account_id = $1";
        }

        if (filters?.assetId) {
            whereClause += ` AND m.asset_id = $${paramIndex}`;
            params.push(filters.assetId);
            paramIndex++;
        }

        if (filters?.startDate) {
            whereClause += ` AND m.created_at >= $${paramIndex}`;
            params.push(filters.startDate);
            paramIndex++;
        }

        if (filters?.endDate) {
            whereClause += ` AND m.created_at <= $${paramIndex}`;
            params.push(filters.endDate);
            paramIndex++;
        }

        const dataQuery = `
            SELECT m.id, m.match_amount, m.rate, m.maturity, m.created_at,
                   m.lender_account_id, m.borrower_account_id,
                   m.maker_fee, m.taker_fee,
                   m.lender_settlement_fee, m.borrower_settlement_fee,
                   a.id as asset_id, a.name, a.symbol, a.image_url,
                   COALESCE(a.decimals, 0) as decimals, a.token_address
            FROM matches m
            JOIN assets a ON m.asset_id = a.id
            ${whereClause}
            ORDER BY m.created_at DESC
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;
        params.push(limit, offset);

        const countQuery = `
            SELECT COUNT(*) as count
            FROM matches m
            ${whereClause}
        `;

        const [rows, countResult] = await Promise.all([
            this.dataSource.query(dataQuery, params),
            this.dataSource.query(countQuery, params.slice(0, paramIndex - 1)),
        ]);

        return {
            data: rows,
            total: Number.parseInt(countResult[0]?.count || "0", 10),
        };
    }
}
