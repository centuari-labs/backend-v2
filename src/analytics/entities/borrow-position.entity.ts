import {
    Column,
    CreateDateColumn,
    Entity,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from "typeorm";

@Entity("borrow_positions")
export class BorrowPosition {
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

    @Column({ name: "original_debt", type: "numeric" })
    originalDebt: string;

    @Column({ name: "debt", type: "numeric" })
    debt: string;

    @CreateDateColumn({ name: "created_at" })
    createdAt: Date;

    @UpdateDateColumn({ name: "updated_at" })
    updatedAt: Date;
}
