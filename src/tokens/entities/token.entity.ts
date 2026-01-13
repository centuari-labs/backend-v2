import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

@Entity("supported_tokens")
export class Token {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ length: 255, unique: true })
    @Index()
    address: string;

    @Column({ length: 20 })
    symbol: string;

    @Column({ length: 100 })
    name: string;

    @Column({ type: "int", default: 18 })
    decimals: number;

    @Column({ name: "token_image", type: "varchar", length: 255, nullable: true })
    imageUrl: string | null;

    @Column({ name: "is_active", default: true })
    isActive: boolean;

    @CreateDateColumn({ name: "created_at" })
    createdAt: Date;

    @UpdateDateColumn({ name: "updated_at" })
    updatedAt: Date;
}
