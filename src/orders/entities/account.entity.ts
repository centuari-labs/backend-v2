import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity("accounts")
export class Account {
    @PrimaryGeneratedColumn("uuid")
    id: string;

    @Column({ name: "privy_user_id", type: "text" })
    privyUserId: string;

    @Column({ name: "user_wallet", type: "text" })
    userWallet: string;

    @CreateDateColumn({ name: "created_at", type: "timestamp" })
    createdAt: Date;
}
