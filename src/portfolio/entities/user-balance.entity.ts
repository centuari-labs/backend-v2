import { Column, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";
import { BYTEA_HEX } from "../../common/transformers/bytea-hex.transformer";

/**
 * Mirrors the shared `user_balance` table (written by BalanceLedger
 * events from every service initiating on-chain state changes +
 * indexer-v3's tail as fallback). Schema owned by indexer-v3 migrations
 * — this entity is read-only from backend's perspective; mutations go
 * through `applyOnChainEffect`.
 */
@Entity({ name: "user_balance", synchronize: false })
export class UserBalance {
    @PrimaryColumn({
        name: "user_address",
        type: "bytea",
        transformer: BYTEA_HEX,
    })
    userAddress: string;

    @PrimaryColumn({ type: "bytea", transformer: BYTEA_HEX })
    asset: string;

    @Column({ type: "numeric", precision: 78, scale: 0 })
    available: string;

    @Column({
        name: "in_orders",
        type: "numeric",
        precision: 78,
        scale: 0,
    })
    inOrders: string;

    @Column({
        name: "in_yield_router",
        type: "numeric",
        precision: 78,
        scale: 0,
    })
    inYieldRouter: string;

    @Column({ name: "used_as_collateral", type: "boolean" })
    usedAsCollateral: boolean;

    @Column({ name: "flagged_at", type: "bigint" })
    flaggedAt: string;

    @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
    updatedAt: Date;
}
