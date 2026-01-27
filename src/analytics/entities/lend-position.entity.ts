import {
    Column,
    CreateDateColumn,
    Entity,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from "typeorm";

@Entity("lend_positions")
export class LendPosition {
    @PrimaryGeneratedColumn("uuid")
    id: string;

    @Column({ name: "account_id", type: "uuid" })
    accountId: string;

    @Column({ name: "asset_id", type: "uuid" })
    assetId: string;

    @Column({ name: "market_id", type: "uuid" })
    marketId: string;

    @Column({ name: "shares", type: "numeric" })
    shares: string;

    @Column({ name: "original_shares", type: "numeric" })
    originalShares: string;

    @Column({ name: "amount", type: "numeric" })
    amount: string;

    @CreateDateColumn({ name: "created_at" })
    createdAt: Date;

    @UpdateDateColumn({ name: "updated_at" })
    updatedAt: Date;
}
