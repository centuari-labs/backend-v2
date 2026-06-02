-- +goose Up
-- ============================================================================
-- Liquidation audit trail. One row per LiquidationEngine.Liquidated event,
-- enriched with the residual from a same-tx BadDebtRemains (NULL = fully
-- covered, no bad debt).
--
-- Part of the shared on-chain-state schema (backend-v2 is the single migration
-- authority). Written ONLY by the indexer-v3 tail — liquidation is permissionless
-- and is not routed through any eager-path writer — so unlike the dual-written
-- position tables, all stamp columns are NOT NULL: every row is born with a full
-- block stamp, making reorg eviction by applied_by_block_number structurally
-- guaranteed (indexer-v3 core/block-cursor.rewindTo deletes from this table).
-- Idempotent via the UNIQUE (tx, log) stamp. Addresses/hashes BYTEA; token
-- amounts NUMERIC(78,0) (fits uint256); timestamps TIMESTAMPTZ.
-- ============================================================================

CREATE TABLE liquidation_event (
    id                      BIGSERIAL PRIMARY KEY,
    borrower                BYTEA NOT NULL,
    liquidator              BYTEA NOT NULL,
    market_id               BYTEA NOT NULL,
    loan_token              BYTEA NOT NULL,
    collateral_asset        BYTEA NOT NULL,
    repaid                  NUMERIC(78, 0) NOT NULL DEFAULT 0,
    collateral_seized       NUMERIC(78, 0) NOT NULL DEFAULT 0,
    via_maturity            BOOLEAN NOT NULL DEFAULT false,
    -- Residual debt left uncollateralised after a capped seizure; set by the
    -- same-tx BadDebtRemains event. NULL means the liquidation cleared cleanly.
    remaining_debt          NUMERIC(78, 0),
    applied_by_tx_hash      BYTEA NOT NULL,
    applied_by_log_index    INTEGER NOT NULL,
    applied_by_block_hash   BYTEA NOT NULL,
    applied_by_block_number BIGINT NOT NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (applied_by_tx_hash, applied_by_log_index)
);
CREATE INDEX idx_liquidation_event_borrower
    ON liquidation_event (borrower);
CREATE INDEX idx_liquidation_event_market
    ON liquidation_event (market_id);

-- +goose Down
DROP TABLE IF EXISTS liquidation_event;
