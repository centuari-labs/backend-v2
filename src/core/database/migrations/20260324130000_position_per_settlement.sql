-- +goose Up
-- Per-settlement position rows: each settlement creates its own borrow/lend position row
-- instead of aggregating into a single row per (market, wallet).
-- This fixes incorrect principal/interest breakdown in the repay dialog after partial repayments.

-- Unique constraint for idempotency: prevents duplicates from re-processed settlement batches
-- while allowing multiple rows per (account, market) from different settlements.
ALTER TABLE borrow_positions
  ADD CONSTRAINT uq_borrow_position_batch UNIQUE (settlement_batch_id, account_id, market_id);

ALTER TABLE lend_positions
  ADD CONSTRAINT uq_lend_position_batch UNIQUE (settlement_batch_id, account_id, market_id);

-- FIFO index for repay/withdraw queries that order positions by created_at ASC
CREATE INDEX IF NOT EXISTS idx_borrow_positions_fifo
  ON borrow_positions (account_id, market_id, created_at ASC)
  WHERE debt > 0;

CREATE INDEX IF NOT EXISTS idx_lend_positions_fifo
  ON lend_positions (account_id, market_id, created_at ASC)
  WHERE shares > 0;

-- +goose Down
DROP INDEX IF EXISTS idx_lend_positions_fifo;
DROP INDEX IF EXISTS idx_borrow_positions_fifo;
ALTER TABLE lend_positions DROP CONSTRAINT IF EXISTS uq_lend_position_batch;
ALTER TABLE borrow_positions DROP CONSTRAINT IF EXISTS uq_borrow_position_batch;
