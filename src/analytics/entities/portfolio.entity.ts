import {
    Column,
    CreateDateColumn,
    Entity,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from "typeorm";

@Entity("portfolio")
export class Portfolio {
    @PrimaryGeneratedColumn("uuid")
    id: string;

    @Column({ name: "account_id", type: "uuid" })
    accountId: string;

    @Column({ name: "asset_id", type: "uuid" })
    assetId: string;

    @Column({ name: "amount", type: "numeric" })
    amount: string;

    @Column({ name: "is_collateral", type: "boolean", default: false })
    isCollateral: boolean;

    @CreateDateColumn({ name: "created_at" })
    createdAt: Date;

    @UpdateDateColumn({ name: "updated_at" })
    updatedAt: Date;
}
