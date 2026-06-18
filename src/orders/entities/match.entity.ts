import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from "typeorm";

/**
 * Mirrors the `matches` table — written by the matching-engine db-writer
 * at match time, mutated by settlement-engine on settlement (Phase 1A
 * writeback flips `settlement_status` PENDING → SETTLED and stamps
 * `settled_tx_hash` / `settled_at`). Backend reads only; `synchronize: false`
 * keeps TypeORM from ever altering the schema since ownership lives in
 * matching-engine + settlement-engine migrations.
 */
@Entity({ name: "matches", synchronize: false })
export class Match {
    @PrimaryGeneratedColumn("uuid")
    id: string;

    @Column({ name: "lend_order_market_id", type: "uuid" })
    lendOrderMarketId: string;

    @Column({ name: "borrow_order_market_id", type: "uuid" })
    borrowOrderMarketId: string;

    @Column({ name: "asset_id", type: "uuid" })
    assetId: string;

    @Column({ name: "lender_account_id", type: "uuid" })
    lenderAccountId: string;

    @Column({ name: "borrower_account_id", type: "uuid" })
    @Index()
    borrowerAccountId: string;

    @Column({ name: "match_amount", type: "numeric" })
    matchAmount: string;

    @Column({ name: "rate", type: "numeric" })
    rate: string;

    @Column({ name: "is_borrower_taker", type: "boolean" })
    isBorrowerTaker: boolean;

    @Column({ name: "maker_fee", type: "numeric" })
    makerFee: string;

    @Column({ name: "taker_fee", type: "numeric" })
    takerFee: string;

    @Column({ name: "lender_settlement_fee", type: "numeric" })
    lenderSettlementFee: string;

    @Column({ name: "borrower_settlement_fee", type: "numeric" })
    borrowerSettlementFee: string;

    @Column({ name: "maturity", type: "timestamp" })
    maturity: Date;

    @Column({ name: "settlement_status", type: "text", default: "PENDING" })
    settlementStatus: string;

    @Column({
        name: "settlement_failure_reason",
        type: "text",
        nullable: true,
    })
    settlementFailureReason: string | null;

    @Column({ name: "settled_tx_hash", type: "text", nullable: true })
    settledTxHash: string | null;

    @Column({
        name: "settled_at",
        type: "timestamptz",
        nullable: true,
    })
    settledAt: Date | null;

    @CreateDateColumn({ name: "created_at" })
    createdAt: Date;

    @UpdateDateColumn({ name: "updated_at" })
    updatedAt: Date;
}
