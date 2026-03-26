-- +goose Up

-- Table: access codes (inserted manually via SQL)
CREATE TABLE IF NOT EXISTS access_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(64) NOT NULL UNIQUE,
    max_uses INTEGER NOT NULL DEFAULT 1,
    current_uses INTEGER NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Table: redemption log
CREATE TABLE IF NOT EXISTS access_code_redemptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    access_code_id UUID NOT NULL REFERENCES access_codes(id),
    privy_user_id TEXT NOT NULL,
    redeemed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_access_codes_code ON access_codes(code);
CREATE INDEX idx_access_code_redemptions_privy_user_id ON access_code_redemptions(privy_user_id);

-- Add access_granted flag to accounts
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS access_granted BOOLEAN NOT NULL DEFAULT false;

-- +goose Down
ALTER TABLE accounts DROP COLUMN IF EXISTS access_granted;
DROP TABLE IF EXISTS access_code_redemptions;
DROP TABLE IF EXISTS access_codes;
