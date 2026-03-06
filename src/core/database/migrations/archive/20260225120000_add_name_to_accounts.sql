-- +goose Up
ALTER TABLE accounts ADD COLUMN name TEXT;

-- +goose Down
ALTER TABLE accounts DROP COLUMN IF EXISTS name;
