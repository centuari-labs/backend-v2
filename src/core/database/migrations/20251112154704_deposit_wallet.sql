-- Migration: 20251112154704_deposit_wallet.sql
-- +goose Up
BEGIN;

-- Example:
CREATE TABLE deposit_wallets (
  id SERIAL PRIMARY KEY,
  wallet_address VARCHAR(255) NOT NULL,
  paired_wallet_address VARCHAR(255) NOT NULL,
  paired_wallet_primary_key VARCHAR(255) NOT NULL
);

COMMIT;

-- +goose Down
BEGIN;

-- Example rollback:
DROP TABLE IF EXISTS deposit_wallets;

COMMIT;
