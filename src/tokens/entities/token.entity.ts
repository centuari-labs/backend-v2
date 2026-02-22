import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

@Entity("assets")
export class Token {
    @PrimaryGeneratedColumn("uuid")
    id: string;

    @Column({ name: "token_address", type: "text", unique: true })
    @Index()
    tokenAddress: string;

    @Column({ type: "text" })
    symbol: string;

    @Column({ type: "text" })
    name: string;

    @Column({ name: "is_loan_token", type: "boolean" })
    isLoanToken: boolean;

    @Column({ name: "chain_id", type: "numeric", nullable: true })
    chainId: number | null;

    @Column({ name: "image_url", type: "text", nullable: true })
    imageUrl: string | null;

    @Column({ name: "avg_ltv", type: "numeric", nullable: true })
    averageLTV: number | null;

    @Column({ name: "coingecko_id", type: "text", nullable: true })
    coingeckoId: string | null;

    @Column({ type: "int", nullable: true })
    decimals: number | null;

    @CreateDateColumn({ name: "created_at" })
    createdAt: Date;

    @UpdateDateColumn({ name: "updated_at" })
    updatedAt: Date;
}
