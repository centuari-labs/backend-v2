-- Migration: Remove shares and original_shares from lend_positions and borrow_positions.
-- Position size is represented by amount/debt only.

-- +goose Up

ALTER TABLE borrow_positions
    DROP COLUMN IF EXISTS shares,
    DROP COLUMN IF EXISTS original_shares;

-- +goose Down

ALTER TABLE borrow_positions
    ADD COLUMN IF NOT EXISTS shares NUMERIC NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS original_shares NUMERIC NOT NULL DEFAULT 0;
