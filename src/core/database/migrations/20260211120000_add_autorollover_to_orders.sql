-- Migration: Add auto_rollover column to orders table
-- Stores whether an order should automatically roll over at maturity.

-- +goose Up

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS auto_rollover BOOLEAN NOT NULL DEFAULT FALSE;

-- +goose Down

ALTER TABLE orders
    DROP COLUMN IF EXISTS auto_rollover;