-- Consolidated UUID default fixes for core tables.
-- Ensures random UUID defaults for accounts.id, orders.id, order_markets.order_market_id, and markets.id.

-- +goose Up

-- Ensure required extensions exist for UUID generation functions.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Set default random UUID for accounts.id using gen_random_uuid().
ALTER TABLE accounts
    ALTER COLUMN id SET DEFAULT gen_random_uuid();

ALTER TABLE orders
    ALTER COLUMN id SET DEFAULT gen_random_uuid();

ALTER TABLE order_markets
    ALTER COLUMN order_market_id SET DEFAULT gen_random_uuid();

ALTER TABLE markets
    ALTER COLUMN id SET DEFAULT gen_random_uuid();


-- +goose Down

ALTER TABLE accounts
    ALTER COLUMN id DROP DEFAULT;

ALTER TABLE orders
    ALTER COLUMN id DROP DEFAULT;

ALTER TABLE order_markets
    ALTER COLUMN order_market_id DROP DEFAULT;

ALTER TABLE markets
    ALTER COLUMN id DROP DEFAULT;

