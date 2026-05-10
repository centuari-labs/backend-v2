-- +goose Up
-- Per-(collateral, loan) HF buffer for borrow orders. Backend's place-order
-- and update-order paths reject borrows whose health factor lands below
-- 1.0 + buffer/10000, leaving margin for oracle drift between order
-- acceptance and on-chain settlement (~30s–few min). Default 100 bps (1%);
-- per-pair overrides can land later via seed without a schema change.
ALTER TABLE risk
  ADD COLUMN IF NOT EXISTS borrow_buffer_bps INT NOT NULL DEFAULT 100;

-- +goose Down
ALTER TABLE risk DROP COLUMN IF EXISTS borrow_buffer_bps;
