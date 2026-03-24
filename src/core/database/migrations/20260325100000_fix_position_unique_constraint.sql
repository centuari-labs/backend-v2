-- +goose Up
-- Fix: allow multiple positions per (batch, account, market) at different rates/amounts.
-- The old constraint silently dropped positions when the same lender was matched
-- against multiple borrowers in a single settlement batch.

ALTER TABLE lend_positions
  DROP CONSTRAINT IF EXISTS uq_lend_position_batch;
ALTER TABLE lend_positions
  ADD CONSTRAINT uq_lend_position_batch UNIQUE (settlement_batch_id, account_id, market_id, apr, amount);

ALTER TABLE borrow_positions
  DROP CONSTRAINT IF EXISTS uq_borrow_position_batch;
ALTER TABLE borrow_positions
  ADD CONSTRAINT uq_borrow_position_batch UNIQUE (settlement_batch_id, account_id, market_id, apr, amount);

-- +goose Down
ALTER TABLE lend_positions
  DROP CONSTRAINT IF EXISTS uq_lend_position_batch;
ALTER TABLE lend_positions
  ADD CONSTRAINT uq_lend_position_batch UNIQUE (settlement_batch_id, account_id, market_id);

ALTER TABLE borrow_positions
  DROP CONSTRAINT IF EXISTS uq_borrow_position_batch;
ALTER TABLE borrow_positions
  ADD CONSTRAINT uq_borrow_position_batch UNIQUE (settlement_batch_id, account_id, market_id);
