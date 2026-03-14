-- Migration: Align backend schema with Ponder's ponder.schema.ts
-- Adds missing columns, fixes FK references, and adds indexes.

-- +goose Up

-- 1. Add missing columns
ALTER TABLE cbt_assets ADD COLUMN IF NOT EXISTS settlement_batch_id UUID;
ALTER TABLE lend_positions ADD COLUMN IF NOT EXISTS settlement_batch_id UUID;
ALTER TABLE borrow_positions ADD COLUMN IF NOT EXISTS settlement_batch_id UUID;

-- 2. Fix matches FK: should reference order_markets, not orders
ALTER TABLE matches DROP CONSTRAINT IF EXISTS fk_lend_order;
ALTER TABLE matches DROP CONSTRAINT IF EXISTS fk_borrow_order;
ALTER TABLE matches ADD CONSTRAINT fk_lend_order_market
    FOREIGN KEY (lend_order_market_id) REFERENCES order_markets(order_market_id);
ALTER TABLE matches ADD CONSTRAINT fk_borrow_order_market
    FOREIGN KEY (borrow_order_market_id) REFERENCES order_markets(order_market_id);

-- 3. Add missing indexes
CREATE INDEX IF NOT EXISTS idx_settlement_batches_status ON settlement_batches(status);
CREATE INDEX IF NOT EXISTS idx_settlement_batches_created_at ON settlement_batches(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_matches_asset_id ON matches(asset_id);
CREATE INDEX IF NOT EXISTS idx_matches_maturity ON matches(maturity);
CREATE INDEX IF NOT EXISTS idx_matches_lender_account_id ON matches(lender_account_id);
CREATE INDEX IF NOT EXISTS idx_matches_borrower_account_id ON matches(borrower_account_id);
CREATE INDEX IF NOT EXISTS idx_matches_created_at ON matches(created_at);
CREATE INDEX IF NOT EXISTS idx_portfolio_account_id ON portfolio(account_id);
CREATE INDEX IF NOT EXISTS idx_portfolio_asset_id ON portfolio(asset_id);
CREATE INDEX IF NOT EXISTS idx_lend_positions_cbt_asset_id ON lend_positions(cbt_asset_id);
CREATE INDEX IF NOT EXISTS idx_lend_positions_settlement_batch_id ON lend_positions(settlement_batch_id);
CREATE INDEX IF NOT EXISTS idx_borrow_positions_settlement_batch_id ON borrow_positions(settlement_batch_id);
CREATE INDEX IF NOT EXISTS idx_cbt_assets_settlement_batch_id ON cbt_assets(settlement_batch_id);

-- +goose Down

DROP INDEX IF EXISTS idx_cbt_assets_settlement_batch_id;
DROP INDEX IF EXISTS idx_borrow_positions_settlement_batch_id;
DROP INDEX IF EXISTS idx_lend_positions_settlement_batch_id;
DROP INDEX IF EXISTS idx_lend_positions_cbt_asset_id;
DROP INDEX IF EXISTS idx_portfolio_asset_id;
DROP INDEX IF EXISTS idx_portfolio_account_id;
DROP INDEX IF EXISTS idx_matches_created_at;
DROP INDEX IF EXISTS idx_matches_borrower_account_id;
DROP INDEX IF EXISTS idx_matches_lender_account_id;
DROP INDEX IF EXISTS idx_matches_maturity;
DROP INDEX IF EXISTS idx_matches_asset_id;
DROP INDEX IF EXISTS idx_orders_created_at;
DROP INDEX IF EXISTS idx_settlement_batches_created_at;
DROP INDEX IF EXISTS idx_settlement_batches_status;

ALTER TABLE matches DROP CONSTRAINT IF EXISTS fk_borrow_order_market;
ALTER TABLE matches DROP CONSTRAINT IF EXISTS fk_lend_order_market;

ALTER TABLE borrow_positions DROP COLUMN IF EXISTS settlement_batch_id;
ALTER TABLE lend_positions DROP COLUMN IF EXISTS settlement_batch_id;
ALTER TABLE cbt_assets DROP COLUMN IF EXISTS settlement_batch_id;
