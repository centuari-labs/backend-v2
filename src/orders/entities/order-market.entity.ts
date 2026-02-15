import {
    Column,
    CreateDateColumn,
    Entity,
    PrimaryGeneratedColumn,
} from "typeorm";

@Entity("order_markets")
export class OrderMarket {
    @PrimaryGeneratedColumn("uuid", { name: "order_market_id" })
    orderMarketId: string;

    @Column({ name: "order_id", type: "uuid" })
    orderId: string;

    @Column({ name: "market_id", type: "uuid" })
    marketId: string;

    @CreateDateColumn({ name: "created_at" })
    createdAt: Date;
}
