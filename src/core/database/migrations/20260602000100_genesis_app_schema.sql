-- +goose Up
-- ============================================================================
-- GENESIS — backend-owned relational schema (runs SECOND).
--
-- Tables at their post-C4 final shape: the legacy markets / portfolio /
-- lend_positions / borrow_positions (plural, UUID) / cbt_assets /
-- settlement_batches / settlement_items tables are simply never created — C4
-- dropped them. Borrow/lend positions are represented in `matches` (settlement
-- tracking) + the BYTEA-keyed borrow_position / lend_position tables from the
-- on-chain genesis migration.
--
-- The dead `settlement_batch_status` enum (its table was dropped in C4 and
-- nothing references it) is intentionally NOT carried forward.
--
-- Depends on the on-chain genesis (market) for order_markets.fk_market.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE order_side AS ENUM ('LEND', 'BORROW');
CREATE TYPE order_type AS ENUM ('MARKET', 'LIMIT');
CREATE TYPE order_status AS ENUM ('OPEN', 'FILLED', 'CANCELLED', 'PARTIALLY_FILLED');
CREATE TYPE cancel_reason AS ENUM ('USER_CANCELLED', 'IOC', 'SETTLEMENT_FAILED', 'MARKET_MATURED');

-- Recomputes assets.avg_ltv from the risk matrix on every risk-row change.
CREATE FUNCTION update_avg_ltv() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    affected_loan_token_id UUID;
BEGIN
    -- Determine which loan_token_id was affected
    IF TG_OP = 'INSERT' THEN
        affected_loan_token_id := NEW.loan_token_id;
    ELSIF TG_OP = 'UPDATE' THEN
        -- Handle both old and new loan_token_id in case it changed
        IF OLD.loan_token_id IS DISTINCT FROM NEW.loan_token_id THEN
            -- Update avg_ltv for old loan token
            UPDATE assets
            SET avg_ltv = (
                SELECT AVG(ltv)::numeric
                FROM risk
                WHERE loan_token_id = OLD.loan_token_id
            )
            WHERE id = OLD.loan_token_id;

            -- Update avg_ltv for new loan token
            affected_loan_token_id := NEW.loan_token_id;
        ELSE
            -- loan_token_id didn't change, just update for this token
            affected_loan_token_id := NEW.loan_token_id;
        END IF;
    ELSIF TG_OP = 'DELETE' THEN
        affected_loan_token_id := OLD.loan_token_id;
    END IF;

    -- Update avg_ltv for the affected loan token
    UPDATE assets
    SET avg_ltv = (
        SELECT AVG(ltv)::numeric
        FROM risk
        WHERE loan_token_id = affected_loan_token_id
    )
    WHERE id = affected_loan_token_id;

    -- Return appropriate record based on operation
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$;

CREATE TABLE accounts (
    id             UUID DEFAULT gen_random_uuid() NOT NULL,
    privy_user_id  TEXT NOT NULL,
    user_wallet    TEXT NOT NULL,
    created_at     TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    name           TEXT,
    access_granted BOOLEAN DEFAULT false NOT NULL,
    CONSTRAINT accounts_pkey PRIMARY KEY (id),
    CONSTRAINT uq_privy_user_id UNIQUE (privy_user_id)
);

CREATE TABLE assets (
    id            UUID DEFAULT gen_random_uuid() NOT NULL,
    name          TEXT NOT NULL,
    symbol        TEXT NOT NULL,
    token_address TEXT NOT NULL,
    is_loan_token BOOLEAN NOT NULL,
    created_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    chain_id      NUMERIC,
    avg_ltv       NUMERIC,
    coingecko_id  TEXT,
    decimals      INTEGER DEFAULT 18 NOT NULL,
    image_url     TEXT,
    CONSTRAINT assets_pkey PRIMARY KEY (id)
);

CREATE TABLE risk (
    id                  UUID DEFAULT gen_random_uuid() NOT NULL,
    collateral_token_id UUID NOT NULL,
    loan_token_id       UUID NOT NULL,
    ltv                 NUMERIC NOT NULL,
    lt                  NUMERIC NOT NULL,
    lp                  NUMERIC NOT NULL,
    created_at          TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at          TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    borrow_buffer_bps   INTEGER DEFAULT 100 NOT NULL,
    CONSTRAINT risk_pkey PRIMARY KEY (id),
    CONSTRAINT unique_collateral_loan_pair UNIQUE (collateral_token_id, loan_token_id),
    CONSTRAINT fk_collateral_token FOREIGN KEY (collateral_token_id) REFERENCES assets(id) ON DELETE CASCADE,
    CONSTRAINT fk_loan_token FOREIGN KEY (loan_token_id) REFERENCES assets(id) ON DELETE CASCADE
);
CREATE TRIGGER risk_insert_trigger AFTER INSERT ON risk FOR EACH ROW EXECUTE FUNCTION update_avg_ltv();
CREATE TRIGGER risk_update_trigger AFTER UPDATE ON risk FOR EACH ROW EXECUTE FUNCTION update_avg_ltv();
CREATE TRIGGER risk_delete_trigger AFTER DELETE ON risk FOR EACH ROW EXECUTE FUNCTION update_avg_ltv();

CREATE TABLE orders (
    id                    UUID DEFAULT gen_random_uuid() NOT NULL,
    account_id            UUID NOT NULL,
    asset_id              UUID NOT NULL,
    side                  order_side NOT NULL,
    type                  order_type NOT NULL,
    rate                  NUMERIC NOT NULL,
    quantity              NUMERIC NOT NULL,
    filled_quantity       NUMERIC DEFAULT 0 NOT NULL,
    settlement_fee        NUMERIC NOT NULL,
    filled_settlement_fee NUMERIC,
    status                order_status NOT NULL,
    created_at            TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at            TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    auto_rollover         BOOLEAN DEFAULT false NOT NULL,
    cancel_reason         cancel_reason,
    CONSTRAINT orders_pkey PRIMARY KEY (id),
    CONSTRAINT fk_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE INDEX idx_orders_created_at ON orders (created_at);

-- market_id is BYTEA, FKs the shared on-chain market registry.
CREATE TABLE order_markets (
    order_market_id UUID DEFAULT gen_random_uuid() NOT NULL,
    order_id        UUID NOT NULL,
    created_at      TIMESTAMPTZ,
    market_id       BYTEA NOT NULL,
    CONSTRAINT order_markets_pkey PRIMARY KEY (order_market_id),
    CONSTRAINT fk_order FOREIGN KEY (order_id) REFERENCES orders(id),
    CONSTRAINT fk_market FOREIGN KEY (market_id) REFERENCES market(market_id) ON DELETE RESTRICT
);

-- Written by matching-engine db-writer + settlement-engine writeback; backend
-- reads only. No FKs (dropped in C4 — orders are matched cross-process).
CREATE TABLE matches (
    id                       UUID DEFAULT gen_random_uuid() NOT NULL,
    lend_order_market_id     UUID NOT NULL,
    borrow_order_market_id   UUID NOT NULL,
    asset_id                 UUID NOT NULL,
    lender_account_id        UUID NOT NULL,
    borrower_account_id      UUID NOT NULL,
    match_amount             NUMERIC NOT NULL,
    rate                     NUMERIC NOT NULL,
    is_borrower_taker        BOOLEAN NOT NULL,
    maker_fee                NUMERIC NOT NULL,
    taker_fee                NUMERIC NOT NULL,
    lender_settlement_fee    NUMERIC NOT NULL,
    borrower_settlement_fee  NUMERIC NOT NULL,
    maturity                 TIMESTAMPTZ NOT NULL,
    created_at               TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at               TIMESTAMPTZ DEFAULT now() NOT NULL,
    settlement_status        TEXT DEFAULT 'PENDING' NOT NULL,
    settlement_failure_reason TEXT,
    settled_tx_hash          TEXT,
    settled_at               TIMESTAMPTZ,
    CONSTRAINT matches_pkey PRIMARY KEY (id)
);
CREATE INDEX idx_matches_asset_id ON matches (asset_id);
CREATE INDEX idx_matches_borrower_account_id ON matches (borrower_account_id);
CREATE INDEX idx_matches_borrower_settlement_status ON matches (borrower_account_id, settlement_status);
CREATE INDEX idx_matches_created_at ON matches (created_at);
CREATE INDEX idx_matches_lender_account_id ON matches (lender_account_id);
CREATE INDEX idx_matches_maturity ON matches (maturity);

-- Invite-gating.
CREATE TABLE access_codes (
    id           UUID DEFAULT gen_random_uuid() NOT NULL,
    code         VARCHAR(64) NOT NULL,
    max_uses     INTEGER DEFAULT 1 NOT NULL,
    current_uses INTEGER DEFAULT 0 NOT NULL,
    expires_at   TIMESTAMPTZ,
    is_active    BOOLEAN DEFAULT true NOT NULL,
    created_at   TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT access_codes_pkey PRIMARY KEY (id),
    CONSTRAINT access_codes_code_key UNIQUE (code)
);
CREATE INDEX idx_access_codes_code ON access_codes (code);

CREATE TABLE access_code_redemptions (
    id             UUID DEFAULT gen_random_uuid() NOT NULL,
    access_code_id UUID NOT NULL,
    privy_user_id  TEXT NOT NULL,
    redeemed_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT access_code_redemptions_pkey PRIMARY KEY (id),
    CONSTRAINT access_code_redemptions_access_code_id_fkey FOREIGN KEY (access_code_id) REFERENCES access_codes(id)
);
CREATE INDEX idx_access_code_redemptions_privy_user_id ON access_code_redemptions (privy_user_id);

-- Legacy backend indexer progress cursor.
CREATE TABLE indexer_state (
    id                   VARCHAR(255) NOT NULL,
    last_processed_block BIGINT DEFAULT 0 NOT NULL,
    updated_at           TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT indexer_state_pkey PRIMARY KEY (id)
);

-- Deposit dedup log for backend eager writers.
CREATE TABLE processed_tx_logs (
    tx_hash    TEXT NOT NULL,
    log_index  INTEGER NOT NULL,
    event_name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT processed_tx_logs_pkey PRIMARY KEY (tx_hash, log_index)
);
CREATE INDEX idx_processed_tx_logs_event ON processed_tx_logs (event_name);

-- Pre-settlement collateral-flag intent buffer. Cross-service write surface
-- (backend INSERT/DELETE, settlement-engine DELETE, indexer-v3 DELETE).
CREATE TABLE pending_collateral_flags (
    id           BIGSERIAL NOT NULL,
    user_address BYTEA NOT NULL,
    asset        BYTEA NOT NULL,
    created_at   TIMESTAMPTZ DEFAULT now() NOT NULL,
    CONSTRAINT pending_collateral_flags_pkey PRIMARY KEY (id),
    CONSTRAINT pending_collateral_flags_user_address_asset_key UNIQUE (user_address, asset)
);
CREATE INDEX pending_collateral_flags_user_idx ON pending_collateral_flags (user_address);

-- +goose Down
DROP TABLE IF EXISTS pending_collateral_flags;
DROP TABLE IF EXISTS processed_tx_logs;
DROP TABLE IF EXISTS indexer_state;
DROP TABLE IF EXISTS access_code_redemptions;
DROP TABLE IF EXISTS access_codes;
DROP TABLE IF EXISTS matches;
DROP TABLE IF EXISTS order_markets;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS risk;
DROP TABLE IF EXISTS assets;
DROP TABLE IF EXISTS accounts;
DROP FUNCTION IF EXISTS update_avg_ltv();
DROP TYPE IF EXISTS cancel_reason;
DROP TYPE IF EXISTS order_status;
DROP TYPE IF EXISTS order_type;
DROP TYPE IF EXISTS order_side;
