-- Seed: 20260120174542_supported_tokens.sql
BEGIN;

-- Example:
-- INSERT INTO users (name, email)
-- VALUES ('Afrijal Dzuhri', 'afrijal@example.com');
INSERT INTO assets (name, symbol, image_url, token_address, is_loan_token, lltv, lt, lp) VALUES
    ('Bitcoin', 'BTC', 'https://cryptologos.cc/logos/bitcoin-btc-logo.png', '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', true, 0.75, 0.80, 0.10),
    ('Ethereum', 'ETH', 'https://cryptologos.cc/logos/ethereum-eth-logo.png', '0x0000000000000000000000000000000000000002', true, 0.75, 0.80, 0.10),
    ('Tether Gold', 'XAUT', 'https://cryptologos.cc/logos/tether-gold-xaut-logo.png', '0x0000000000000000000000000000000000000003', true, 0.70, 0.75, 0.10),
    ('USD Coin', 'USDC', 'https://cryptologos.cc/logos/usd-coin-usdc-logo.png', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', true, 0.85, 0.90, 0.05),
    ('Indonesian Rupiah Token', 'IDRX', 'https://example.com/idrx.png', '0x18Bc5bcC660cf2B9cE3cd51a404aFe1a0cBD3C22', true, 0.85, 0.90, 0.05),
    ('Singapore Dollar Token', 'XSGD', 'https://example.com/xsgd.png', '0x0000000000000000000000000000000000000006', true, 0.85, 0.90, 0.05),
    ('Kinesis Silver', 'KAG', 'https://example.com/kag.png', '0x0000000000000000000000000000000000000007', true, 0.70, 0.75, 0.10),
    ('NVIDIA Token', 'NVDAX', 'https://example.com/nvdax.png', '0x0000000000000000000000000000000000000008', true, 0.60, 0.65, 0.15),
    ('Tesla Token', 'TSLAX', 'https://example.com/tslax.png', '0x0000000000000000000000000000000000000009', true, 0.60, 0.65, 0.15),
    ('Ondo Short-Term US Government Bond', 'OUSG', 'https://example.com/ousg.png', '0x000000000000000000000000000000000000000a', true, 0.80, 0.85, 0.05);


COMMIT;
