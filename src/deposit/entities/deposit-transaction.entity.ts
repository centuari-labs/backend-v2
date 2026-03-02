import {
    Column,
    CreateDateColumn,
    Entity,
    PrimaryGeneratedColumn,
} from "typeorm";

@Entity("deposit_transactions")
export class DepositTransaction {
    @PrimaryGeneratedColumn("uuid")
    id: string;

    @Column({ name: "tx_hash", type: "text", unique: true })
    txHash: string;

    @Column({ name: "asset_id", type: "uuid" })
    assetId: string;

    @Column({ name: "account_id", type: "uuid" })
    accountId: string;

    @Column({ name: "amount", type: "numeric" })
    amount: string;

    @Column({ name: "from_address", type: "text" })
    fromAddress: string;

    @Column({ name: "token_address", type: "text" })
    tokenAddress: string;

    @Column({ name: "chain_id", type: "integer" })
    chainId: number;

    @CreateDateColumn({ name: "created_at" })
    createdAt: Date;
}
