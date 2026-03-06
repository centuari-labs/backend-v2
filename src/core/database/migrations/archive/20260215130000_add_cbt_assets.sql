-- Migration: Add cbt_assets table and cbt_asset_id to lend_positions
-- CBT Assets per market (name, symbol, token_address).
-- lend_positions can reference a CBT asset when applicable.

-- +goose Up

CREATE TABLE IF NOT EXISTS cbt_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    market_id UUID NOT NULL,
    name TEXT NOT NULL,
    symbol TEXT NOT NULL,
    token_address TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_market FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE CASCADE
);

ALTER TABLE lend_positions
    ADD COLUMN IF NOT EXISTS cbt_asset_id UUID NULL,
    ADD CONSTRAINT fk_lend_position_cbt_asset FOREIGN KEY (cbt_asset_id) REFERENCES cbt_assets(id) ON DELETE SET NULL;

-- +goose Down

ALTER TABLE lend_positions
    DROP CONSTRAINT IF EXISTS fk_lend_position_cbt_asset,
    DROP COLUMN IF EXISTS cbt_asset_id;

DROP TABLE IF EXISTS cbt_assets;
