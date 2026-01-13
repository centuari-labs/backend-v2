-- Migration: supported_tokens table
-- +goose Up
BEGIN;

CREATE TABLE supported_tokens (
    id SERIAL PRIMARY KEY,
    address VARCHAR(255) NOT NULL UNIQUE,
    symbol VARCHAR(20) NOT NULL,
    name VARCHAR(100) NOT NULL,
    decimals INTEGER NOT NULL DEFAULT 18,
    token_image VARCHAR(255),
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

-- Seed data for supported tokens
INSERT INTO supported_tokens (address, symbol, name, decimals, token_image, is_active) VALUES
    ('0x0000000000000000000000000000000000000001', 'BTC', 'Bitcoin', 8, 'https://cryptologos.cc/logos/bitcoin-btc-logo.png', true),
    ('0x0000000000000000000000000000000000000002', 'ETH', 'Ethereum', 18, 'https://cryptologos.cc/logos/ethereum-eth-logo.png', true),
    ('0x0000000000000000000000000000000000000003', 'XAUT', 'Tether Gold', 6, 'https://cryptologos.cc/logos/tether-gold-xaut-logo.png', true),
    ('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 'USDC', 'USD Coin', 6, 'https://cryptologos.cc/logos/usd-coin-usdc-logo.png', true),
    ('0x0000000000000000000000000000000000000005', 'IDRX', 'Indonesian Rupiah Token', 6, 'https://example.com/idrx.png', true),
    ('0x0000000000000000000000000000000000000006', 'XSGD', 'Singapore Dollar Token', 6, 'https://example.com/xsgd.png', true),
    ('0x0000000000000000000000000000000000000007', 'KAG', 'Kinesis Silver', 4, 'https://example.com/kag.png', true),
    ('0x0000000000000000000000000000000000000008', 'NVDAX', 'NVIDIA Token', 18, 'https://example.com/nvdax.png', true),
    ('0x0000000000000000000000000000000000000009', 'TSLAX', 'Tesla Token', 18, 'https://example.com/tslax.png', true),
    ('0x000000000000000000000000000000000000000a', 'OUSG', 'Ondo Short-Term US Government Bond', 18, 'https://example.com/ousg.png', true);

COMMIT;

-- +goose Down
BEGIN;

DROP TRIGGER IF EXISTS update_supported_tokens_updated_at ON supported_tokens;
DROP FUNCTION IF EXISTS update_supported_tokens_updated_at();
DROP TABLE IF EXISTS supported_tokens CASCADE;

COMMIT;
