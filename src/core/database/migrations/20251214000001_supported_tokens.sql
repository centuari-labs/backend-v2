-- Migration: supported_tokens table
-- +goose Up
BEGIN;

CREATE TABLE supported_tokens (
    id SERIAL PRIMARY KEY,
    address VARCHAR(255) NOT NULL UNIQUE,
    symbol VARCHAR(20) NOT NULL,
    name VARCHAR(100) NOT NULL,
    decimals INTEGER NOT NULL DEFAULT 18,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_supported_tokens_address ON supported_tokens(address);
CREATE INDEX idx_supported_tokens_is_active ON supported_tokens(is_active);

-- Create trigger for updated_at
CREATE OR REPLACE FUNCTION update_supported_tokens_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_supported_tokens_updated_at 
    BEFORE UPDATE ON supported_tokens
    FOR EACH ROW EXECUTE FUNCTION update_supported_tokens_updated_at();

COMMIT;

-- +goose Down
BEGIN;

DROP TRIGGER IF EXISTS update_supported_tokens_updated_at ON supported_tokens;
DROP FUNCTION IF EXISTS update_supported_tokens_updated_at();
DROP TABLE IF EXISTS supported_tokens CASCADE;

COMMIT;
