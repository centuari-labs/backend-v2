import { Column, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";
import { BYTEA_HEX } from "../../common/transformers/bytea-hex.transformer";

/**
 * Mirrors the shared `lend_position` table. Read-only from backend —
 * mutations go through `applyOnChainEffect` in
 * `apply-withdraw-lend.ts` + settlement-engine's `applySettlementResult`,
 * both of which stamp `applied_by_*`.
 */
@Entity({ name: "lend_position", synchronize: false })
export class LendPosition {
    @PrimaryColumn({ name: "market_id", type: "bytea", transformer: BYTEA_HEX })
    marketId: string;

    @PrimaryColumn({ type: "bytea", transformer: BYTEA_HEX })
    lender: string;

    @Column({ name: "bond_token", type: "bytea", transformer: BYTEA_HEX })
    bondToken: string;

    @Column({
        name: "cbt_balance",
        type: "numeric",
        precision: 78,
        scale: 0,
    })
    cbtBalance: string;

    @Column({ type: "numeric", precision: 78, scale: 0 })
    principal: string;

    @Column({ type: "numeric", precision: 78, scale: 0 })
    rate: string;

    @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
    updatedAt: Date;
}
