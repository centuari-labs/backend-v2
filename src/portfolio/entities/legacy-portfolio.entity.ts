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

/**
 * Legacy backend-v2 `portfolio` table — UUID-keyed balance + locked-amount
 * + is-collateral rollup that predates the shared on-chain-state schema.
 * Still written to by `ChainIndexerService` (legacy Treasury deposit
 * indexer, Phase C) and the legacy `/withdraw` endpoint (Phase C).
 *
 * A6 drops this table + entity entirely. In the meantime the A5 read
 * migration reads balances from the new `UserBalance` entity against
 * `user_balance` instead.
 */
@Entity("portfolio")
export class LegacyPortfolio {
    @PrimaryColumn("uuid")
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

    @Column({ name: "locked_amount", type: "numeric", default: "0" })
    lockedAmount: string;

    @Column({ name: "is_collateral", type: "boolean", default: false })
    isCollateral: boolean;

    @CreateDateColumn({ name: "created_at" })
    createdAt: Date;

    @UpdateDateColumn({ name: "updated_at" })
    updatedAt: Date;
}
