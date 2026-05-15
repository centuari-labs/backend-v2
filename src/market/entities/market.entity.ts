import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryColumn,
} from "typeorm";
import { BYTEA_HEX } from "../../common/transformers/bytea-hex.transformer";

/**
 * Mirrors the shared `market` table — the canonical market registry.
 * Written by two paths:
 *   1. Backend's `MarketCreationService` eager-write when an operator
 *      registers a new (loanToken, maturity).
 *   2. indexer-v3's `centuari.processor.ts` tail-write on first
 *      `Centuari.MarketCreated` event (ON CONFLICT DO NOTHING — second
 *      writer is a safe no-op).
 *
 * MarketId encoding (today): `uuidToBytes32(legacyUuid)` where
 * `legacyUuid = first 16 bytes of keccak256(abi.encode(loanToken,
 * maturity))` formatted as UUID. This is the calldata-verbatim value
 * `Centuari.settleMatch` re-emits via `MarketCreated` (see
 * [Centuari.sol:81-102]). The aspirational form
 * `keccak256(abi.encode(loanToken, maturity))` (full 32 bytes) is NOT
 * what flows on-chain today — see [market-creation.service.ts] and
 * the C4 plan §Phase 3 §A for the encoding landmine.
 */
@Entity({ name: "market", synchronize: false })
export class Market {
    @PrimaryColumn({ name: "market_id", type: "bytea", transformer: BYTEA_HEX })
    marketId: string;

    @Index()
    @Column({ name: "loan_token", type: "bytea", transformer: BYTEA_HEX })
    loanToken: string;

    @Column({ type: "bigint" })
    maturity: string;

    @CreateDateColumn({ name: "created_at", type: "timestamptz" })
    createdAt: Date;
}
