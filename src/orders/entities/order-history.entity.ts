import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
} from "typeorm";
import { Order } from "./order.entity";

@Entity("order_history")
export class OrderHistory {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ name: "order_id", type: "uuid" })
    orderId: string;

    @ManyToOne(() => Order, { onDelete: "CASCADE" })
    @JoinColumn({ name: "order_id" })
    order: Order;

    @Column({
        name: "previous_status",
        type: "varchar",
        length: 50,
        nullable: true,
    })
    previousStatus: string | null;

    @Column({ name: "new_status", type: "varchar", length: 50 })
    newStatus: string;

    @Column({
        name: "previous_remaining_amount",
        type: "decimal",
        precision: 36,
        scale: 0,
        nullable: true,
    })
    previousRemainingAmount: string | null;

    @Column({
        name: "new_remaining_amount",
        type: "decimal",
        precision: 36,
        scale: 0,
        nullable: true,
    })
    newRemainingAmount: string | null;

    @Column({ name: "change_reason", type: "text", nullable: true })
    changeReason: string | null;

    @Column({
        name: "transaction_hash",
        type: "varchar",
        length: 255,
        nullable: true,
    })
    transactionHash: string | null;

    @CreateDateColumn({ name: "created_at" })
    createdAt: Date;
}
