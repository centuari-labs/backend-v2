-- Seed: 20260120174542_supported_tokens.sql
BEGIN;

-- Base Testnet (Chain ID: 84532) supported tokens
INSERT INTO assets (name, symbol, token_address, is_loan_token, lltv, lt, lp, chain_id) VALUES
    ('Bitcoin', 'BTC', '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', true, 0.75, 0.80, 0.10, 84532),
    ('Ethereum', 'ETH', '0x4200000000000000000000000000000000000006', true, 0.75, 0.80, 0.10, 84532),
    ('Tether Gold', 'XAUT', '0x0000000000000000000000000000000000000003', true, 0.70, 0.75, 0.10, 84532),
    ('USD Coin', 'USDC', '0x036CbD53842c5426634e7929541eC2318f3dCF7e', true, 0.85, 0.90, 0.05, 84532),
    ('Indonesian Rupiah Token', 'IDRX', '0x18Bc5bcC660cf2B9cE3cd51a404aFe1a0cBD3C22', true, 0.85, 0.90, 0.05, 84532),
    ('Singapore Dollar Token', 'XSGD', '0x0000000000000000000000000000000000000006', true, 0.85, 0.90, 0.05, 84532),
    ('Kinesis Silver', 'KAG', '0x0000000000000000000000000000000000000007', true, 0.70, 0.75, 0.10, 84532),
    ('NVIDIA Token', 'NVDAX', '0x0000000000000000000000000000000000000008', true, 0.60, 0.65, 0.15, 84532),
    ('Tesla Token', 'TSLAX', '0x0000000000000000000000000000000000000009', true, 0.60, 0.65, 0.15, 84532),
    ('Ondo Short-Term US Government Bond', 'OUSG', '0x000000000000000000000000000000000000000a', true, 0.80, 0.85, 0.05, 84532);

COMMIT;
