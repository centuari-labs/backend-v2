-- Migration: Add autorollover column to orders table
-- Stores whether an order should automatically roll over at maturity.

-- +goose Up

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS autorollover BOOLEAN NOT NULL DEFAULT FALSE;

-- +goose Down

ALTER TABLE orders
    DROP COLUMN IF EXISTS autorollover;