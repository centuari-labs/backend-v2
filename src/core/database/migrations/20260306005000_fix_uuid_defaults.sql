-- Consolidated UUID default fixes for all tables with UUID primary keys.
-- Mirrors indexer-v2/ponder.schema.ts: ensures gen_random_uuid() default for every UUID PK column.

-- +goose Up

-- Ensure required extensions exist for UUID generation functions.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE accounts
    ALTER COLUMN id SET DEFAULT gen_random_uuid();

ALTER TABLE assets
    ALTER COLUMN id SET DEFAULT gen_random_uuid();

ALTER TABLE risk
    ALTER COLUMN id SET DEFAULT gen_random_uuid();

ALTER TABLE settlement_batches
    ALTER COLUMN id SET DEFAULT gen_random_uuid();

ALTER TABLE markets
    ALTER COLUMN id SET DEFAULT gen_random_uuid();

ALTER TABLE cbt_assets
    ALTER COLUMN id SET DEFAULT gen_random_uuid();

ALTER TABLE orders
    ALTER COLUMN id SET DEFAULT gen_random_uuid();

ALTER TABLE order_markets
    ALTER COLUMN order_market_id SET DEFAULT gen_random_uuid();

ALTER TABLE portfolio
    ALTER COLUMN id SET DEFAULT gen_random_uuid();

ALTER TABLE lend_positions
    ALTER COLUMN id SET DEFAULT gen_random_uuid();

ALTER TABLE borrow_positions
    ALTER COLUMN id SET DEFAULT gen_random_uuid();

ALTER TABLE matches
    ALTER COLUMN id SET DEFAULT gen_random_uuid();

ALTER TABLE settlement_items
    ALTER COLUMN id SET DEFAULT gen_random_uuid();


-- +goose Down

ALTER TABLE accounts
    ALTER COLUMN id DROP DEFAULT;

ALTER TABLE assets
    ALTER COLUMN id DROP DEFAULT;

ALTER TABLE risk
    ALTER COLUMN id DROP DEFAULT;

ALTER TABLE settlement_batches
    ALTER COLUMN id DROP DEFAULT;

ALTER TABLE markets
    ALTER COLUMN id DROP DEFAULT;

ALTER TABLE cbt_assets
    ALTER COLUMN id DROP DEFAULT;

ALTER TABLE orders
    ALTER COLUMN id DROP DEFAULT;

ALTER TABLE order_markets
    ALTER COLUMN order_market_id DROP DEFAULT;

ALTER TABLE portfolio
    ALTER COLUMN id DROP DEFAULT;

ALTER TABLE lend_positions
    ALTER COLUMN id DROP DEFAULT;

ALTER TABLE borrow_positions
    ALTER COLUMN id DROP DEFAULT;

ALTER TABLE matches
    ALTER COLUMN id DROP DEFAULT;

ALTER TABLE settlement_items
    ALTER COLUMN id DROP DEFAULT;

