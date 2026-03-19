-- Migration: Add locked_amount to portfolio table
-- Tracks funds locked by matched orders pending on-chain settlement.
-- Available balance = amount - locked_amount - open_orders_sum

-- +goose Up

ALTER TABLE portfolio ADD COLUMN IF NOT EXISTS locked_amount NUMERIC NOT NULL DEFAULT 0;

-- +goose Down

ALTER TABLE portfolio DROP COLUMN IF EXISTS locked_amount;
