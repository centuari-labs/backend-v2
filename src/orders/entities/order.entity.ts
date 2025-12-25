import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

export type OrderType = "lend_market" | "lend_limit" | "borrow_market" | "borrow_limit";
export type OrderCategory = "lend" | "borrow";
export type OrderStatus = "pending" | "partial" | "filled" | "cancelled";

@Entity("orders")
export class Order {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ name: "wallet_address", type: "varchar", length: 255 })
    @Index()
    walletAddress: string;

    @Column({ name: "order_type", type: "varchar", length: 50 })
    @Index()
    orderType: OrderType;

    @Column({ name: "order_category", type: "varchar", length: 50 })
    @Index()
    orderCategory: OrderCategory;

    @Column({ name: "is_market_order", type: "boolean", default: false })
    isMarketOrder: boolean;

    @Column({ name: "asset_address", type: "varchar", length: 255 })
    @Index()
    assetAddress: string;

    @Column({ type: "decimal", precision: 36, scale: 18 })
    amount: string;

    @Column({ name: "limit_price", type: "decimal", precision: 36, scale: 18, nullable: true })
    limitPrice: string | null;

    @Column({ name: "limit_expiry", type: "timestamp", nullable: true })
    limitExpiry: Date | null;

    @Column({ name: "interest_rate", type: "decimal", precision: 10, scale: 6, nullable: true })
    interestRate: string | null;

    @Column({ name: "duration_days", type: "int", nullable: true })
    durationDays: number | null;

    @Column({ name: "collateral_asset_address", type: "varchar", length: 255, nullable: true })
    collateralAssetAddress: string | null;

    @Column({ name: "collateral_amount", type: "decimal", precision: 36, scale: 18, nullable: true })
    collateralAmount: string | null;

    @Column({ name: "collateral_ratio", type: "decimal", precision: 10, scale: 6, nullable: true })
    collateralRatio: string | null;

    @Column({ type: "varchar", length: 50, default: "pending" })
    @Index()
    status: OrderStatus;

    @Column({ name: "filled_amount", type: "decimal", precision: 36, scale: 18, default: 0 })
    filledAmount: string;

    @Column({ name: "remaining_amount", type: "decimal", precision: 36, scale: 18 })
    remainingAmount: string;

    @Column({ name: "transaction_hash", type: "varchar", length: 255, nullable: true })
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
