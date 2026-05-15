import {
    Column,
    CreateDateColumn,
    Entity,
    PrimaryGeneratedColumn,
} from "typeorm";
import { BYTEA_HEX } from "../../common/transformers/bytea-hex.transformer";

@Entity("order_markets")
export class OrderMarket {
    @PrimaryGeneratedColumn("uuid", { name: "order_market_id" })
    orderMarketId: string;

    @Column({ name: "order_id", type: "uuid" })
    orderId: string;

    @Column({ name: "market_id", type: "bytea", transformer: BYTEA_HEX })
    marketId: string;

    @CreateDateColumn({ name: "created_at" })
    createdAt: Date;
}
