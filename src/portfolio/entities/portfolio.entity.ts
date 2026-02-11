import { Token } from "../../tokens/entities/token.entity";
import { Account } from "../../orders/entities/account.entity";
import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryColumn,
    UpdateDateColumn,
} from "typeorm";

@Entity("portfolio")
export class Portfolio {
    @PrimaryColumn('uuid')
    id: string;

    @Column({ name: "asset_id", type: "uuid" })
    assetId: string;

    @ManyToOne(() => Token)
    @JoinColumn({ name: "asset_id" })
    asset: Token;

    @Column({ name: "account_id", type: "uuid" })
    accountId: string;

    @ManyToOne(() => Account)
    @JoinColumn({ name: "account_id" })
    account: Account;

    @Column({ name: "amount", type: "numeric" })
    amount: string;

    @Column({ name: "is_collateral", type: "boolean", default: false })
    isCollateral: boolean;

    @CreateDateColumn({ name: "created_at" })
    createdAt: Date;

    @UpdateDateColumn({ name: "updated_at" })
    updatedAt: Date;
}
