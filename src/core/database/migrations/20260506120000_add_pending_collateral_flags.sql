-- +goose Up
-- pending_collateral_flags queues user-requested collateral flag operations
-- when the user has an open borrow order. Settlement engine consumes the
-- queue at match time, encodes assets into MatchData.collateralAssets, and
-- DELETEs consumed rows on receipt success.
CREATE TABLE IF NOT EXISTS pending_collateral_flags (
    id BIGSERIAL PRIMARY KEY,
    user_address BYTEA NOT NULL,
    asset BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_address, asset)
);

CREATE INDEX IF NOT EXISTS pending_collateral_flags_user_idx
    ON pending_collateral_flags (user_address);

-- +goose Down
DROP TABLE IF EXISTS pending_collateral_flags;
