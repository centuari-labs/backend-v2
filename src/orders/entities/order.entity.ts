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
    @PrimaryGeneratedColumn("uuid")
    id: string;

    @Column({ name: "account_id", type: "uuid" })
    @Index()
    accountId: string;

    @Column({ name: "asset_id", type: "uuid" })
    @Index()
    assetId: string;

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

    @Column({ name: "rate", type: "numeric" })
    rate: number;

    @Column({ name: "quantity", type: "numeric" })
    quantity: string;

    @Column({ name: "filled_quantity", type: "numeric", default: 0 })
    filledQuantity: string;

    @Column({ name: "settlement_fee", type: "numeric" })
    settlementFee: string;

    @Column({ name: "filled_settlement_fee", type: "numeric", nullable: true })
    filledSettlementFee: string | null;

    @Column({
        name: "status",
        type: "enum",
        enum: OrderStatus,
    })
    @Index()
    status: OrderStatus;

    @CreateDateColumn({ name: "created_at" })
    createdAt: Date;

    @UpdateDateColumn({ name: "updated_at" })
    updatedAt: Date;
}
