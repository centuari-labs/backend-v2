-- Migration: Convert all TIMESTAMP columns to TIMESTAMPTZ
-- Ensures consistent UTC storage across all tables, preventing
-- timezone drift when services run outside UTC.

-- +goose Up

-- assets
ALTER TABLE assets ALTER COLUMN created_at TYPE TIMESTAMPTZ;
ALTER TABLE assets ALTER COLUMN updated_at TYPE TIMESTAMPTZ;

-- risk
ALTER TABLE risk ALTER COLUMN created_at TYPE TIMESTAMPTZ;
ALTER TABLE risk ALTER COLUMN updated_at TYPE TIMESTAMPTZ;

-- markets
ALTER TABLE markets ALTER COLUMN maturity TYPE TIMESTAMPTZ;
ALTER TABLE markets ALTER COLUMN created_at TYPE TIMESTAMPTZ;

-- orders
ALTER TABLE orders ALTER COLUMN created_at TYPE TIMESTAMPTZ;
ALTER TABLE orders ALTER COLUMN updated_at TYPE TIMESTAMPTZ;

-- order_markets
ALTER TABLE order_markets ALTER COLUMN created_at TYPE TIMESTAMPTZ;

-- lend_positions
ALTER TABLE lend_positions ALTER COLUMN created_at TYPE TIMESTAMPTZ;
ALTER TABLE lend_positions ALTER COLUMN updated_at TYPE TIMESTAMPTZ;

-- borrow_positions
ALTER TABLE borrow_positions ALTER COLUMN created_at TYPE TIMESTAMPTZ;
ALTER TABLE borrow_positions ALTER COLUMN updated_at TYPE TIMESTAMPTZ;

-- matches
ALTER TABLE matches ALTER COLUMN maturity TYPE TIMESTAMPTZ;
ALTER TABLE matches ALTER COLUMN created_at TYPE TIMESTAMPTZ;
ALTER TABLE matches ALTER COLUMN updated_at TYPE TIMESTAMPTZ;

-- settlement_items
ALTER TABLE settlement_items ALTER COLUMN created_at TYPE TIMESTAMPTZ;
ALTER TABLE settlement_items ALTER COLUMN updated_at TYPE TIMESTAMPTZ;

-- cbt_assets
ALTER TABLE cbt_assets ALTER COLUMN created_at TYPE TIMESTAMPTZ;
ALTER TABLE cbt_assets ALTER COLUMN updated_at TYPE TIMESTAMPTZ;

-- processed_tx_logs
ALTER TABLE processed_tx_logs ALTER COLUMN created_at TYPE TIMESTAMPTZ;

-- indexer_state
ALTER TABLE indexer_state ALTER COLUMN updated_at TYPE TIMESTAMPTZ;

-- migrations_log
ALTER TABLE migrations_log ALTER COLUMN executed_at TYPE TIMESTAMPTZ;

-- +goose Down

-- assets
ALTER TABLE assets ALTER COLUMN created_at TYPE TIMESTAMP;
ALTER TABLE assets ALTER COLUMN updated_at TYPE TIMESTAMP;

-- risk
ALTER TABLE risk ALTER COLUMN created_at TYPE TIMESTAMP;
ALTER TABLE risk ALTER COLUMN updated_at TYPE TIMESTAMP;

-- markets
ALTER TABLE markets ALTER COLUMN maturity TYPE TIMESTAMP;
ALTER TABLE markets ALTER COLUMN created_at TYPE TIMESTAMP;

-- orders
ALTER TABLE orders ALTER COLUMN created_at TYPE TIMESTAMP;
ALTER TABLE orders ALTER COLUMN updated_at TYPE TIMESTAMP;

-- order_markets
ALTER TABLE order_markets ALTER COLUMN created_at TYPE TIMESTAMP;

-- lend_positions
ALTER TABLE lend_positions ALTER COLUMN created_at TYPE TIMESTAMP;
ALTER TABLE lend_positions ALTER COLUMN updated_at TYPE TIMESTAMP;

-- borrow_positions
ALTER TABLE borrow_positions ALTER COLUMN created_at TYPE TIMESTAMP;
ALTER TABLE borrow_positions ALTER COLUMN updated_at TYPE TIMESTAMP;

-- matches
ALTER TABLE matches ALTER COLUMN maturity TYPE TIMESTAMP;
ALTER TABLE matches ALTER COLUMN created_at TYPE TIMESTAMP;
ALTER TABLE matches ALTER COLUMN updated_at TYPE TIMESTAMP;

-- settlement_items
ALTER TABLE settlement_items ALTER COLUMN created_at TYPE TIMESTAMP;
ALTER TABLE settlement_items ALTER COLUMN updated_at TYPE TIMESTAMP;

-- cbt_assets
ALTER TABLE cbt_assets ALTER COLUMN created_at TYPE TIMESTAMP;
ALTER TABLE cbt_assets ALTER COLUMN updated_at TYPE TIMESTAMP;

-- processed_tx_logs
ALTER TABLE processed_tx_logs ALTER COLUMN created_at TYPE TIMESTAMP;

-- indexer_state
ALTER TABLE indexer_state ALTER COLUMN updated_at TYPE TIMESTAMP;

-- migrations_log
ALTER TABLE migrations_log ALTER COLUMN executed_at TYPE TIMESTAMP;
