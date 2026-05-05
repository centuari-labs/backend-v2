-- +goose Up
-- Add settlement tracking columns to matches table
ALTER TABLE matches ADD COLUMN IF NOT EXISTS settlement_status TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE matches ADD COLUMN IF NOT EXISTS settlement_failure_reason TEXT;

-- Add SETTLEMENT_FAILED to cancel_reason enum for orders cancelled due to failed settlement
ALTER TYPE cancel_reason ADD VALUE IF NOT EXISTS 'SETTLEMENT_FAILED';

-- +goose Down
ALTER TABLE matches DROP COLUMN IF EXISTS settlement_failure_reason;
ALTER TABLE matches DROP COLUMN IF EXISTS settlement_status;
-- Note: PostgreSQL cannot remove enum values; SETTLEMENT_FAILED will remain in the type
