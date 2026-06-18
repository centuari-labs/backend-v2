-- +goose Up
-- ============================================================================
-- GENESIS — shared on-chain-state schema (runs FIRST).
--
-- Consolidates the formerly indexer-v3-owned migrations (001_init,
-- 002_recent_block_hashes, 003_deposit_event_kind, 004_centuari_positions)
-- into backend-v2, which is now the single migration authority for the
-- protocol Postgres database. indexer-v3 no longer runs migrations at boot.
--
-- These tables are written by both the eager path (backend-v2,
-- settlement-engine, sweeper-bot via @centuari-labs/on-chain-effects) and the
-- indexer-v3 tail. Every mutable row carries a C10 idempotency stamp
-- (applied_by_*). All timestamps TIMESTAMPTZ; addresses + hashes BYTEA; token
-- amounts NUMERIC(78,0) (fits uint256).
--
-- Created before the app schema so order_markets.market_id can FK market.
-- ============================================================================

-- Per-chain indexer block cursor.
CREATE TABLE block_cursor (
    chain_id          INTEGER PRIMARY KEY,
    last_block        BIGINT NOT NULL,
    last_block_hash   BYTEA NOT NULL,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Rolling block-hash buffer for reorg detection.
CREATE TABLE recent_block_hashes (
    chain_id     INTEGER NOT NULL,
    block_number BIGINT NOT NULL,
    block_hash   BYTEA NOT NULL,
    inserted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, block_number)
);
CREATE INDEX idx_recent_block_hashes_chain_block
    ON recent_block_hashes (chain_id, block_number DESC);

-- 3-state balance model + virtual collateral flag. NO `collateral` column —
-- collateral is HF-gated. used_as_collateral + flagged_at mirror CollateralFlagSet.
CREATE TABLE user_balance (
    user_address            BYTEA NOT NULL,
    asset                   BYTEA NOT NULL,
    available               NUMERIC(78, 0) NOT NULL DEFAULT 0,
    in_orders               NUMERIC(78, 0) NOT NULL DEFAULT 0,
    in_yield_router         NUMERIC(78, 0) NOT NULL DEFAULT 0,
    used_as_collateral      BOOLEAN NOT NULL DEFAULT false,
    flagged_at              BIGINT NOT NULL DEFAULT 0,
    applied_by_tx_hash      BYTEA,
    applied_by_log_index    INTEGER,
    applied_by_block_hash   BYTEA,
    applied_by_block_number BIGINT,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_address, asset)
);
CREATE INDEX idx_user_balance_flagged
    ON user_balance (user_address)
    WHERE used_as_collateral = true;

-- HubDepositor Deposit/Payout log. kind discriminates the two event types.
CREATE TABLE deposit_event (
    id           BIGSERIAL PRIMARY KEY,
    chain_id     INTEGER NOT NULL,
    user_address BYTEA NOT NULL,
    asset        BYTEA NOT NULL,
    amount       NUMERIC(78, 0) NOT NULL,
    source_chain INTEGER NOT NULL,
    tx_hash      BYTEA NOT NULL,
    block_number BIGINT NOT NULL,
    block_hash   BYTEA NOT NULL,
    log_index    INTEGER NOT NULL,
    "timestamp"  TIMESTAMPTZ NOT NULL,
    kind         TEXT NOT NULL DEFAULT 'DEPOSIT',
    UNIQUE (tx_hash, log_index)
);
CREATE INDEX idx_deposit_event_user ON deposit_event (user_address);
CREATE INDEX idx_deposit_event_user_kind ON deposit_event (user_address, kind);

-- Withdrawal state machine (PENDING|PROCESSING|COMPLETED|FAILED).
CREATE TABLE withdrawal_request (
    request_id              BYTEA PRIMARY KEY,
    user_address            BYTEA NOT NULL,
    asset                   BYTEA NOT NULL,
    amount                  NUMERIC(78, 0) NOT NULL,
    target_chain            INTEGER NOT NULL,
    state                   TEXT NOT NULL,
    created_at              TIMESTAMPTZ NOT NULL,
    updated_at              TIMESTAMPTZ NOT NULL,
    completed_at            TIMESTAMPTZ,
    applied_by_tx_hash      BYTEA,
    applied_by_log_index    INTEGER,
    applied_by_block_hash   BYTEA,
    applied_by_block_number BIGINT
);
CREATE INDEX idx_withdrawal_user_state
    ON withdrawal_request (user_address, state);

-- Cross-chain deposit flow (custody BRIDGED|SPOKE_NATIVE; state INITIATED|CREDITED|BRIDGED|REFUNDED).
CREATE TABLE cross_chain_deposit (
    deposit_id              BYTEA PRIMARY KEY,
    user_address            BYTEA NOT NULL,
    source_chain            INTEGER NOT NULL,
    asset                   BYTEA NOT NULL,
    amount                  NUMERIC(78, 0) NOT NULL,
    custody_type            TEXT NOT NULL,
    state                   TEXT NOT NULL,
    initiated_at            TIMESTAMPTZ NOT NULL,
    credited_at             TIMESTAMPTZ,
    bridged_at              TIMESTAMPTZ,
    applied_by_tx_hash      BYTEA,
    applied_by_log_index    INTEGER,
    applied_by_block_hash   BYTEA,
    applied_by_block_number BIGINT
);
CREATE INDEX idx_crosschain_user_state
    ON cross_chain_deposit (user_address, state);

-- Bond-token registry (one per lender bond).
CREATE TABLE bond_token (
    address      BYTEA PRIMARY KEY,
    asset        BYTEA NOT NULL,
    maturity     BIGINT NOT NULL,
    total_supply NUMERIC(78, 0) NOT NULL DEFAULT 0
);

-- SPOKE_NATIVE per-chain rollup (hooks only in Phase 1).
CREATE TABLE chain_liquidity (
    token                   BYTEA NOT NULL,
    chain_id                INTEGER NOT NULL,
    amount                  NUMERIC(78, 0) NOT NULL DEFAULT 0,
    applied_by_tx_hash      BYTEA,
    applied_by_log_index    INTEGER,
    applied_by_block_hash   BYTEA,
    applied_by_block_number BIGINT,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (token, chain_id)
);

-- Centuari market registry. applied_by_* is NULLABLE: the backend cron
-- eager-creates markets (via applyMarketCreatedMutation) before any
-- MarketCreated event fires. order_markets.market_id FKs this table.
CREATE TABLE market (
    market_id               BYTEA PRIMARY KEY,
    loan_token              BYTEA NOT NULL,
    maturity                BIGINT NOT NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    applied_by_tx_hash      BYTEA,
    applied_by_log_index    INTEGER,
    applied_by_block_hash   BYTEA,
    applied_by_block_number BIGINT
);
CREATE INDEX idx_market_loan_token_maturity ON market (loan_token, maturity);

-- One row per (market, borrower); principal/debt roll up across events.
CREATE TABLE borrow_position (
    market_id               BYTEA NOT NULL,
    borrower                BYTEA NOT NULL,
    principal               NUMERIC(78, 0) NOT NULL DEFAULT 0,
    debt                    NUMERIC(78, 0) NOT NULL DEFAULT 0,
    rate                    NUMERIC(78, 0) NOT NULL DEFAULT 0,
    applied_by_tx_hash      BYTEA,
    applied_by_log_index    INTEGER,
    applied_by_block_hash   BYTEA,
    applied_by_block_number BIGINT,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (market_id, borrower)
);
CREATE INDEX idx_borrow_position_borrower
    ON borrow_position (borrower)
    WHERE debt > 0;

-- One row per (market, lender).
CREATE TABLE lend_position (
    market_id               BYTEA NOT NULL,
    lender                  BYTEA NOT NULL,
    bond_token              BYTEA NOT NULL,
    cbt_balance             NUMERIC(78, 0) NOT NULL DEFAULT 0,
    principal               NUMERIC(78, 0) NOT NULL DEFAULT 0,
    rate                    NUMERIC(78, 0) NOT NULL DEFAULT 0,
    applied_by_tx_hash      BYTEA,
    applied_by_log_index    INTEGER,
    applied_by_block_hash   BYTEA,
    applied_by_block_number BIGINT,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (market_id, lender)
);
CREATE INDEX idx_lend_position_lender
    ON lend_position (lender)
    WHERE cbt_balance > 0;

-- +goose Down
DROP TABLE IF EXISTS lend_position;
DROP TABLE IF EXISTS borrow_position;
DROP TABLE IF EXISTS market;
DROP TABLE IF EXISTS chain_liquidity;
DROP TABLE IF EXISTS bond_token;
DROP TABLE IF EXISTS cross_chain_deposit;
DROP TABLE IF EXISTS withdrawal_request;
DROP TABLE IF EXISTS deposit_event;
DROP TABLE IF EXISTS user_balance;
DROP TABLE IF EXISTS recent_block_hashes;
DROP TABLE IF EXISTS block_cursor;
