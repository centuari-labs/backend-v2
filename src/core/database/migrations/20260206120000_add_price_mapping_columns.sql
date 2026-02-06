-- Migration: Add coingecko_id and mock_price_usd columns to assets table
-- These columns store the CoinGecko coin ID for live price fetching,
-- or a mock USD price for testnet-only tokens not on CoinGecko.

-- +goose Up

ALTER TABLE assets ADD COLUMN IF NOT EXISTS coingecko_id TEXT NULL;

-- +goose Down

ALTER TABLE assets DROP COLUMN IF EXISTS coingecko_id;
