-- Migration: 00000000000001_init_schema.sql
-- This migration represents the consolidated database schema
-- Merged from 26 individual migration files into a single canonical schema

-- +goose Up

-- Step 1: Create ENUM types
CREATE TYPE order_side AS ENUM ('LEND', 'BORROW');
CREATE TYPE order_type AS ENUM ('MARKET', 'LIMIT');
CREATE TYPE order_status AS ENUM ('OPEN', 'FILLED', 'CANCELLED', 'PARTIALLY_FILLED');
CREATE TYPE settlement_batch_status AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- Step 2: Create independent tables (no foreign key dependencies)

-- Accounts table
CREATE TABLE IF NOT EXISTS accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    privy_user_id TEXT NOT NULL,
    user_wallet TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Assets table
CREATE TABLE IF NOT EXISTS assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    symbol TEXT NOT NULL,
    token_address TEXT NOT NULL,
    is_loan_token BOOLEAN NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    chain_id NUMERIC
);

-- Risk table (depends on assets)
CREATE TABLE IF NOT EXISTS risk (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    collateral_token_id UUID NOT NULL,
    loan_token_id UUID NOT NULL,
    ltv NUMERIC NOT NULL,
    lt NUMERIC NOT NULL,
    lp NUMERIC NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_collateral_token FOREIGN KEY (collateral_token_id) REFERENCES assets(id) ON DELETE CASCADE,
    CONSTRAINT fk_loan_token FOREIGN KEY (loan_token_id) REFERENCES assets(id) ON DELETE CASCADE,
    CONSTRAINT unique_collateral_loan_pair UNIQUE (collateral_token_id, loan_token_id)
);

-- Settlement batches table (UUID primary key)
CREATE TABLE IF NOT EXISTS settlement_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tx_hash TEXT NOT NULL,
    status settlement_batch_status NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE markets (
  id UUID PRIMARY KEY,
  asset_id UUID NOT NULL,
  maturity TIMESTAMP,
  created_at TIMESTAMP,

  CONSTRAINT fk_asset FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);

-- Orders table (depends on accounts, assets)
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL,
    asset_id UUID NOT NULL,
    side order_side NOT NULL,
    type order_type NOT NULL,
    rate NUMERIC NOT NULL,
    quantity NUMERIC NOT NULL,
    filled_quantity NUMERIC NOT NULL DEFAULT 0,
    settlement_fee NUMERIC NOT NULL,
    filled_settlement_fee NUMERIC,
    status order_status NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE TABLE order_markets (
  order_market_id UUID PRIMARY KEY,
  order_id UUID NOT NULL,
  market_id UUID NOT NULL,
  created_at TIMESTAMP,

  CONSTRAINT fk_order
    FOREIGN KEY (order_id)
    REFERENCES orders(id),

  CONSTRAINT fk_market
    FOREIGN KEY (market_id)
    REFERENCES markets(id),

  CONSTRAINT unique_order_market
    UNIQUE (order_id, market_id)
);


-- Portfolio table (depends on accounts)
CREATE TABLE IF NOT EXISTS portfolio (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL,
    asset_id UUID NOT NULL,
    amount NUMERIC NOT NULL,
    is_collateral BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_portfolio_account FOREIGN KEY (account_id) REFERENCES accounts(id),
    CONSTRAINT fk_portfolio_asset FOREIGN KEY (asset_id) REFERENCES assets(id)
);

-- Lend positions table (depends on accounts, assets, markets)
CREATE TABLE IF NOT EXISTS lend_positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL,
    asset_id UUID NOT NULL,
    market_id UUID NOT NULL,
    shares NUMERIC NOT NULL,
    original_shares NUMERIC NOT NULL,
    amount NUMERIC NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    CONSTRAINT fk_asset FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
    CONSTRAINT fk_market FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE CASCADE
);

-- Borrow positions table (depends on accounts, assets, markets)
CREATE TABLE IF NOT EXISTS borrow_positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL,
    asset_id UUID NOT NULL,
    market_id UUID NOT NULL,
    shares NUMERIC NOT NULL,
    original_shares NUMERIC NOT NULL,
    amount NUMERIC NOT NULL,
    original_debt NUMERIC NOT NULL,
    debt NUMERIC NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    CONSTRAINT fk_asset FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
    CONSTRAINT fk_market FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE CASCADE
);

-- Matches table (depends on orders, assets, accounts)
CREATE TABLE IF NOT EXISTS matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lend_order_market_id UUID NOT NULL,
    borrow_order_market_id UUID NOT NULL,
    asset_id UUID NOT NULL,
    lender_account_id UUID NOT NULL,
    borrower_account_id UUID NOT NULL,
    match_amount NUMERIC NOT NULL,
    rate NUMERIC NOT NULL,
    is_borrower_taker BOOLEAN NOT NULL,
    maker_fee NUMERIC NOT NULL,
    taker_fee NUMERIC NOT NULL,
    lender_settlement_fee NUMERIC NOT NULL,
    borrower_settlement_fee NUMERIC NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_lend_order FOREIGN KEY (lend_order_market_id) REFERENCES orders(id),
    CONSTRAINT fk_borrow_order FOREIGN KEY (borrow_order_market_id) REFERENCES orders(id)
);

-- Settlement items table (depends on matches, settlement_batches)
CREATE TABLE IF NOT EXISTS settlement_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    settlement_batch_id UUID NOT NULL,
    match_id UUID NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_match FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
    CONSTRAINT fk_settlement_batch FOREIGN KEY (settlement_batch_id) REFERENCES settlement_batches(id) ON DELETE CASCADE
);

-- +goose Down

DROP TABLE IF EXISTS settlement_items;
DROP TABLE IF EXISTS matches;
DROP TABLE IF EXISTS borrow_positions;
DROP TABLE IF EXISTS lend_positions;
DROP TABLE IF EXISTS portfolio;
DROP TABLE IF EXISTS order_markets;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS markets;
DROP TABLE IF EXISTS settlement_batches;
DROP TABLE IF EXISTS risk;
DROP TABLE IF EXISTS assets;
DROP TABLE IF EXISTS accounts;

DROP TYPE IF EXISTS settlement_batch_status;
DROP TYPE IF EXISTS order_status;
DROP TYPE IF EXISTS order_type;
DROP TYPE IF EXISTS order_side;
