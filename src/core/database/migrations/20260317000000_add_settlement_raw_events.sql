-- Migration: Add raw_events and events_processed to settlement_batches
-- Enables two-phase persistence: settlement records are committed first,
-- event processing (positions, markets, cbt_assets) can fail and retry independently.

-- +goose Up

ALTER TABLE settlement_batches ADD COLUMN IF NOT EXISTS raw_events JSONB;
ALTER TABLE settlement_batches ADD COLUMN IF NOT EXISTS events_processed BOOLEAN NOT NULL DEFAULT false;

-- Mark existing batches as already processed (they went through the old single-transaction path)
UPDATE settlement_batches SET events_processed = true WHERE events_processed = false;

CREATE INDEX IF NOT EXISTS idx_settlement_batches_unprocessed
    ON settlement_batches(events_processed) WHERE events_processed = false;

-- +goose Down

DROP INDEX IF EXISTS idx_settlement_batches_unprocessed;
ALTER TABLE settlement_batches DROP COLUMN IF EXISTS events_processed;
ALTER TABLE settlement_batches DROP COLUMN IF EXISTS raw_events;
