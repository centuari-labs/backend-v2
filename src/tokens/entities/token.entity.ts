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

    @Column({ name: "image_url", type: "text" })
    imageUrl: string;

    @Column({ name: "is_loan_token", type: "boolean" })
    isLoanToken: boolean;

    @Column({ name: "lltv", type: "decimal" })
    LLTV: number;

    @Column({ name: "lt", type: "decimal" })
    LT: number;

    @Column({ name: "lp", type: "decimal" })
    LP: number;

    @CreateDateColumn({ name: "created_at" })
    createdAt: Date;

    @UpdateDateColumn({ name: "updated_at" })
    updatedAt: Date;
}
