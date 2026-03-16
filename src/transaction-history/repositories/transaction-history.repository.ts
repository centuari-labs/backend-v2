import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";

export interface RawTransactionRow {
    id: string;
    type: string;
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
    maturity: string | null;
    fees: string | null;
    created_at: string;
}

@Injectable()
export class TransactionHistoryRepository {
    constructor(private readonly dataSource: DataSource) {}

    async getTransactionHistory(
        accountId: string,
        page: number,
        limit: number,
        type?: "MATCH" | "ORDER",
    ): Promise<{ data: RawTransactionRow[]; total: number }> {
        const offset = (page - 1) * limit;

        const ordersCte = `
            SELECT o.id, 'ORDER' as type, o.side::text, o.type::text as order_type, o.rate,
                   o.quantity as amount, o.filled_quantity, o.status::text,
                   a.symbol, a.image_url, COALESCE(a.decimals, 0) as decimals,
                   a.token_address,
                   NULL::timestamptz as maturity, NULL::numeric as fees, o.created_at
            FROM orders o
            JOIN assets a ON o.asset_id = a.id
            WHERE o.account_id = $1
        `;

        const matchesCte = `
            SELECT m.id, 'MATCH' as type,
                   CASE WHEN m.lender_account_id = $1 THEN 'LEND' ELSE 'BORROW' END as side,
                   NULL::text as order_type, m.rate,
                   m.match_amount as amount, NULL::numeric as filled_quantity, 'MATCHED' as status,
                   a.symbol, a.image_url, COALESCE(a.decimals, 0) as decimals,
                   a.token_address,
                   m.maturity::timestamptz, CASE WHEN m.lender_account_id = $1 THEN m.lender_settlement_fee ELSE m.borrower_settlement_fee END as fees, m.created_at
            FROM matches m
            JOIN assets a ON m.asset_id = a.id
            WHERE m.lender_account_id = $1 OR m.borrower_account_id = $1
        `;

        let unionQuery: string;
        if (type === "ORDER") {
            unionQuery = ordersCte;
        } else if (type === "MATCH") {
            unionQuery = matchesCte;
        } else {
            unionQuery = `${ordersCte} UNION ALL ${matchesCte}`;
        }

        const dataQuery = `
            SELECT * FROM (${unionQuery}) AS combined
            ORDER BY created_at DESC
            LIMIT $2 OFFSET $3
        `;

        const countQuery = `
            SELECT COUNT(*) as count FROM (${unionQuery}) AS combined
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
}
