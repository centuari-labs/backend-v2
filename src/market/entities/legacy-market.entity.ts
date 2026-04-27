import {
    Entity,
    PrimaryColumn,
    Column,
    CreateDateColumn,
    ManyToOne,
    JoinColumn,
    Unique,
} from "typeorm";
import { Token } from "../../tokens/entities/token.entity";

/**
 * Legacy backend-v2 `markets` table (plural) — UUID-keyed market registry
 * that predates the shared on-chain `market` table (singular). Still
 * written to by matching-engine + orders flows (Phase B).
 *
 * A6 drops this table + entity. Shared `Market` entity lives alongside
 * this file and maps to the `market` table.
 */
@Entity("markets")
@Unique(["assetId", "maturity"])
export class LegacyMarket {
    @PrimaryColumn("uuid")
    id: string;

    @Column({ name: "asset_id", type: "uuid" })
    assetId: string;

    @ManyToOne(() => Token)
    @JoinColumn({ name: "asset_id" })
    asset: Token;

    @Column({ type: "timestamptz", nullable: true })
    maturity: Date;

    @CreateDateColumn({ name: "created_at" })
    createdAt: Date;
}
