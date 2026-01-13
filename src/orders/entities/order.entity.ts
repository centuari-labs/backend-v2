import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from "typeorm";
import { OrderSide, OrderType, OrderStatus } from "../constants/order.constants";

@Entity("orders")
export class Order {
    @PrimaryGeneratedColumn("uuid", { name: "order_id" })
    orderId: string;

    @Column({ name: "wallet_address", type: "varchar", length: 255 })
    @Index()
    walletAddress: string;

    @Column({ name: "loan_token", type: "varchar", length: 255 })
    @Index()
    loanToken: string;

    @Column("int", { array: true })
    maturities: number[];

    @Column({ name: "timestamp", type: "bigint" }) // Using bigint for timestamp to be safe, though user asked for number
    timestamp: number;

    @Column({
        name: "side",
        type: "enum",
        enum: OrderSide,
    })
    @Index()
    side: OrderSide;

    @Column({
        name: "type",
        type: "enum",
        enum: OrderType,
    })
    @Index()
    type: OrderType;

    @Column({
        name: "status",
        type: "enum",
        enum: OrderStatus,
        default: OrderStatus.Open,
    })
    @Index()
    status: OrderStatus;

    @Column({ name: "original_amount", type: "decimal", precision: 36, scale: 0 }) // user regex suggests integer string, but usually amounts are large
    originalAmount: string;

    @Column({ name: "remaining_amount", type: "decimal", precision: 36, scale: 0 })
    remainingAmount: string;

    @Column({ name: "settlement_fee_amount", type: "decimal", precision: 36, scale: 0 })
    settlementFeeAmount: string;

    @Column({
        name: "rate",
        type: "int",
        nullable: true,
        comment: "Interest rate in basis points (1% = 100 bp)",
    })
    rate: number | null;

    @Column({
        name: "transaction_hash",
        type: "varchar",
        length: 255,
        nullable: true,
    })
    transactionHash: string | null;

    @Column({ name: "block_number", type: "bigint", nullable: true })
    blockNumber: number | null;

    @CreateDateColumn({ name: "created_at" })
    createdAt: Date;

    @UpdateDateColumn({ name: "updated_at" })
    updatedAt: Date;

    @Column({ name: "filled_at", type: "timestamp", nullable: true })
    filledAt: Date | null;

    @Column({ name: "cancelled_at", type: "timestamp", nullable: true })
    cancelledAt: Date | null;
}
