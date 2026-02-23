-- Migration: Add image_url column to assets table
-- Stores relative path to token icon (e.g. /tokens/usdc-icon.svg)

-- +goose Up

ALTER TABLE assets ADD COLUMN IF NOT EXISTS image_url TEXT;

-- +goose Down

ALTER TABLE assets DROP COLUMN IF EXISTS image_url;
