-- +goose Up
-- Adds a terminal cancel reason for orders auto-expired because their market
-- passed maturity. Resting orders in a matured market can never validly match,
-- so the matching-engine sweep removes them and the db-writer stamps
-- cancel_reason = 'MARKET_MATURED' (status stays CANCELLED). This value MUST
-- exist before the db-writer ever writes it, or the UPDATE fails — deploy this
-- migration ahead of the matching-engine change (mirrors the C4 ordering lesson).
ALTER TYPE cancel_reason ADD VALUE IF NOT EXISTS 'MARKET_MATURED';

-- +goose Down
-- Postgres does not support removing a value from an enum type; intentional no-op.
-- (Removal would require recreating the type and rewriting every dependent column.)
