-- Migration: 20260315120000_add_unique_portfolio_constraint.sql
-- Enforces one portfolio row per (account_id, asset_id) to prevent duplicate asset entries.
-- Step 1: Merge duplicates — sum amounts and OR collateral flags into the earliest row.
-- Step 2: Delete the extra rows.
-- Step 3: Add unique constraint.

-- +goose Up

-- Merge amounts and collateral flags into the keeper row (earliest created_at) per (account_id, asset_id)
UPDATE portfolio p SET
  amount = sub.total_amount,
  is_collateral = sub.any_collateral,
  updated_at = NOW()
FROM (
  SELECT DISTINCT ON (account_id, asset_id)
         account_id,
         asset_id,
         id AS keeper_id,
         SUM(amount) OVER (PARTITION BY account_id, asset_id) AS total_amount,
         BOOL_OR(is_collateral) OVER (PARTITION BY account_id, asset_id) AS any_collateral
  FROM portfolio
  ORDER BY account_id, asset_id, created_at ASC
) sub
WHERE p.id = sub.keeper_id
  AND (SELECT COUNT(*) FROM portfolio p3 WHERE p3.account_id = p.account_id AND p3.asset_id = p.asset_id) > 1;

-- Delete duplicate rows (keep only the earliest per account_id, asset_id)
DELETE FROM portfolio p
WHERE p.id NOT IN (
  SELECT DISTINCT ON (account_id, asset_id) id
  FROM portfolio
  ORDER BY account_id, asset_id, created_at ASC
);

-- Add unique constraint
ALTER TABLE portfolio ADD CONSTRAINT uq_portfolio_account_asset UNIQUE (account_id, asset_id);
