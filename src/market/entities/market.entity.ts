import {
    Column,
    CreateDateColumn,
    Entity,
    PrimaryColumn,
} from "typeorm";
import { BYTEA_HEX } from "../../common/transformers/bytea-hex.transformer";

/**
 * Mirrors the shared `market` table — the canonical market registry
 * written by `Centuari.MarketCreated` event, indexed by 32-byte
 * `marketId = keccak256(abi.encode(loanToken, maturity))`. Read-only
 * from backend.
 */
@Entity({ name: "market", synchronize: false })
export class Market {
    @PrimaryColumn({ name: "market_id", type: "bytea", transformer: BYTEA_HEX })
    marketId: string;

    @Column({ name: "loan_token", type: "bytea", transformer: BYTEA_HEX })
    loanToken: string;

    @Column({ type: "bigint" })
    maturity: string;

    @CreateDateColumn({ name: "created_at", type: "timestamptz" })
    createdAt: Date;
}
