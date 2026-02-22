-- Migration: Add image_url to assets
-- Description: Adds a nullable image_url column to the assets table.

-- +goose Up
ALTER TABLE assets
    ADD COLUMN IF NOT EXISTS image_url TEXT NULL;

-- +goose Down
ALTER TABLE assets
    DROP COLUMN IF EXISTS image_url;
