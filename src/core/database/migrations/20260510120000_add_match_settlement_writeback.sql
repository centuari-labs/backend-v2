-- +goose Up
-- Settlement-engine writes these on the same tx as `settlement_status='SETTLED'`
-- (extends the existing `applyOnChainEffect` mutation closure in
-- settlement-engine/src/settlement/database/apply-settlement.ts). The columns
-- are pure observability — backend never reads them in hot paths today; the
-- lock-release decrement on `portfolio.locked_amount` is the load-bearing
-- side effect of the same writeback.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS settled_tx_hash TEXT;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS settled_at TIMESTAMP WITH TIME ZONE;

-- Lookup index for the FILLED-but-unsettled HF query in backend Phase 1B
-- (`SELECT ... FROM matches WHERE borrower_account_id = ? AND settlement_status = 'PENDING'`).
CREATE INDEX IF NOT EXISTS idx_matches_borrower_settlement_status
  ON matches (borrower_account_id, settlement_status);

-- +goose Down
DROP INDEX IF EXISTS idx_matches_borrower_settlement_status;
ALTER TABLE matches DROP COLUMN IF EXISTS settled_at;
ALTER TABLE matches DROP COLUMN IF EXISTS settled_tx_hash;
