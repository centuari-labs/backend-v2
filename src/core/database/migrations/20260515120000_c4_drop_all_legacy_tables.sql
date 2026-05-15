-- +goose Up
-- ============================================================================
-- C4 mass legacy drop — single atomic cutover that:
--   1. Backfills the new `market` (BYTEA) table from legacy `markets` (UUID)
--      so every `order_markets.market_id` has a target row before the FK swap.
--   2. Mirrors `portfolio.locked_amount` into `user_balance.in_orders` so the
--      in-flight match locks survive the `portfolio` table drop.
--   3. Retypes `order_markets.market_id` from UUID to BYTEA and FKs it to the
--      new `market(market_id)` registry.
--   4. Drops seven legacy tables: markets, portfolio, borrow_positions,
--      lend_positions, cbt_assets, settlement_batches, settlement_items.
--
-- Coordinated with: matching-engine schemas + db-writer SQL (Phase 2.1
-- code change), backend NATS publish + repay + HF reads (Phase 2.2),
-- settlement-engine lock-release (Phase 2.3), frontend hex marketIds
-- (Phase 2.4). Every service must be on the new code when this runs.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Step 1: Backfill new `market` (BYTEA) from legacy `markets` (UUID).
-- MarketId encoding: zero-pad the legacy UUID (strip dashes + right-pad to
-- 32 bytes) — matches `uuidToBytes32(legacyUuid)` used by backend,
-- settlement-engine, and indexer-v3 (`Centuari.MarketCreated` calldata-
-- verbatim invariant from Centuari.sol:81-102).
-- ----------------------------------------------------------------------------
INSERT INTO market (market_id, loan_token, maturity, created_at)
SELECT
  decode(replace(m.id::text, '-', '') || repeat('0', 32), 'hex'),
  decode(substring(t.token_address from 3), 'hex'),
  EXTRACT(EPOCH FROM m.maturity)::bigint,
  COALESCE(m.created_at, now())
FROM markets m
JOIN assets t ON t.id = m.asset_id
ON CONFLICT (market_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Step 2: Mirror `portfolio.locked_amount` into `user_balance.in_orders`.
-- The `in_orders` slot was zero-valued in Phase 1; here it takes over as the
-- live source of truth for match-time locks (matching-engine writes,
-- settlement-engine decrements). Skip rows with zero locked_amount.
-- ----------------------------------------------------------------------------
INSERT INTO user_balance (
  user_address, asset, available, in_orders, in_yield_router,
  used_as_collateral, flagged_at, updated_at
)
SELECT
  decode(substring(a.user_wallet from 3), 'hex'),
  decode(substring(t.token_address from 3), 'hex'),
  0, p.locked_amount, 0, false, 0, now()
FROM portfolio p
JOIN accounts a ON a.id = p.account_id
JOIN assets t ON t.id = p.asset_id
WHERE p.locked_amount > 0
ON CONFLICT (user_address, asset) DO UPDATE SET
  in_orders = EXCLUDED.in_orders,
  updated_at = now();

-- ----------------------------------------------------------------------------
-- Step 3: Retype `order_markets.market_id` UUID → BYTEA + FK to new `market`.
-- ----------------------------------------------------------------------------
ALTER TABLE order_markets DROP CONSTRAINT IF EXISTS fk_market;

ALTER TABLE order_markets ADD COLUMN market_id_bytea BYTEA;
UPDATE order_markets SET market_id_bytea =
  decode(replace(market_id::text, '-', '') || repeat('0', 32), 'hex');
ALTER TABLE order_markets DROP COLUMN market_id;
ALTER TABLE order_markets RENAME COLUMN market_id_bytea TO market_id;
ALTER TABLE order_markets ALTER COLUMN market_id SET NOT NULL;

ALTER TABLE order_markets ADD CONSTRAINT fk_market
  FOREIGN KEY (market_id) REFERENCES market(market_id) ON DELETE RESTRICT;

-- ----------------------------------------------------------------------------
-- Step 4: Drop all legacy tables.
-- ----------------------------------------------------------------------------
DROP TABLE IF EXISTS markets CASCADE;
DROP TABLE IF EXISTS portfolio CASCADE;
DROP TABLE IF EXISTS borrow_positions CASCADE;
DROP TABLE IF EXISTS lend_positions CASCADE;
DROP TABLE IF EXISTS cbt_assets CASCADE;
DROP TABLE IF EXISTS settlement_items CASCADE;
DROP TABLE IF EXISTS settlement_batches CASCADE;

-- +goose Down
-- Down migration is intentionally minimal — restoring seven dropped tables
-- requires their full DDL snapshots from the previous migrations:
--   - `markets`, `order_markets`, `portfolio`, `lend_positions`,
--     `settlement_batches`, `settlement_items` from 20260122123214_centuari_db.sql
--   - `borrow_positions` from the same (or a sibling) seed
--   - `cbt_assets` from 20260215130000_add_cbt_assets.sql
-- If a real rollback is needed, copy those CREATE TABLE statements here
-- and run the inverse data migrations (BYTEA market_id → UUID via the
-- reverse of `bytes32ToUuid`; in_orders → portfolio.locked_amount via the
-- inverse JOIN). For now: forward-only.
ALTER TABLE order_markets DROP CONSTRAINT IF EXISTS fk_market;
