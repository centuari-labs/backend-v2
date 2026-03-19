-- Migration: Add apr column to borrow_positions table
-- Stores the weighted average matched rate in basis points (e.g. 508 = 5.08%).
-- Previously APR was derived from original_debt/amount which gave incorrect results
-- when trading fees exceeded remaining interest to maturity.

-- +goose Up

ALTER TABLE borrow_positions ADD COLUMN IF NOT EXISTS apr NUMERIC NOT NULL DEFAULT 0;

-- +goose Down

ALTER TABLE borrow_positions DROP COLUMN IF EXISTS apr;
