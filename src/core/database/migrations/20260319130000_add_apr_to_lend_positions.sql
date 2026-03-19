-- Migration: Add apr column to lend_positions table
-- Stores the weighted average matched rate in basis points (e.g. 508 = 5.08%).
-- Previously APR was derived from shares/amount which gave incorrect results
-- when trading fees exceeded remaining interest to maturity.

-- +goose Up

ALTER TABLE lend_positions ADD COLUMN IF NOT EXISTS apr NUMERIC NOT NULL DEFAULT 0;

-- +goose Down

ALTER TABLE lend_positions DROP COLUMN IF EXISTS apr;
