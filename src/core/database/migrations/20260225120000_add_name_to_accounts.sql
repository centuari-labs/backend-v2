-- +goose Up
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS name TEXT;

-- +goose Down
ALTER TABLE accounts DROP COLUMN IF EXISTS name;
