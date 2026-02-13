-- Migration: Add decimals column to assets table
-- Token decimal places (e.g. 6 for USDC, 18 for ETH) for amount conversion.

-- +goose Up

ALTER TABLE assets ADD COLUMN IF NOT EXISTS decimals INTEGER NOT NULL DEFAULT 18;

-- +goose Down

ALTER TABLE assets DROP COLUMN IF EXISTS decimals;
