import { Column, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";
import { BYTEA_HEX } from "../../common/transformers/bytea-hex.transformer";

/**
 * Mirrors the shared `borrow_position` table. Read-only from backend —
 * mutations go through `applyOnChainEffect` in `apply-repay.ts` +
 * settlement-engine's `applySettlementResult`.
 */
@Entity({ name: "borrow_position", synchronize: false })
export class BorrowPosition {
    @PrimaryColumn({ name: "market_id", type: "bytea", transformer: BYTEA_HEX })
    marketId: string;

    @PrimaryColumn({ type: "bytea", transformer: BYTEA_HEX })
    borrower: string;

    @Column({ type: "numeric", precision: 78, scale: 0 })
    principal: string;

    @Column({ type: "numeric", precision: 78, scale: 0 })
    debt: string;

    @Column({ type: "numeric", precision: 78, scale: 0 })
    rate: string;

    @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
    updatedAt: Date;
}
