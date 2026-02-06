-- Seed: 20260120174542_supported_tokens.sql
BEGIN;

-- Base Testnet (Chain ID: 84532) supported tokens
INSERT INTO assets (name, symbol, token_address, is_loan_token, chain_id) VALUES
    ('Bitcoin', 'BTC', '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', false, 84532),
    ('Ethereum', 'ETH', '0x4200000000000000000000000000000000000006', false, 84532),
    ('Tether Gold', 'XAUT', '0x0000000000000000000000000000000000000003', false, 84532),
    ('USD Coin', 'USDC', '0x036CbD53842c5426634e7929541eC2318f3dCF7e', true, 84532),
    ('Indonesian Rupiah Token', 'IDRX', '0x18Bc5bcC660cf2B9cE3cd51a404aFe1a0cBD3C22', true, 84532),
    ('Singapore Dollar Token', 'XSGD', '0x0000000000000000000000000000000000000006', true, 84532),
    ('Kinesis Silver', 'KAG', '0x0000000000000000000000000000000000000007', false, 84532),
    ('NVIDIA Token', 'NVDAX', '0x0000000000000000000000000000000000000008', false, 84532),
    ('Tesla Token', 'TSLAX', '0x0000000000000000000000000000000000000009', false, 84532),
    ('Ondo Short-Term US Government Bond', 'OUSG', '0x000000000000000000000000000000000000000a', false, 84532);

-- Risk table seed data: Map collateral tokens to loan tokens
-- Collateral tokens: BTC, ETH, XAUT, KAG, NVDAX, TSLAX, OUSG
-- Loan tokens: USDC, IDRX, XSGD
INSERT INTO risk (collateral_token_id, loan_token_id, ltv, lt, lp)
SELECT 
    collateral.id,
    loan.id,
    CASE collateral.symbol
        WHEN 'BTC' THEN 0.75
        WHEN 'ETH' THEN 0.75
        WHEN 'XAUT' THEN 0.70
        WHEN 'KAG' THEN 0.70
        WHEN 'NVDAX' THEN 0.60
        WHEN 'TSLAX' THEN 0.60
        WHEN 'OUSG' THEN 0.80
    END as ltv,
    CASE collateral.symbol
        WHEN 'BTC' THEN 0.80
        WHEN 'ETH' THEN 0.80
        WHEN 'XAUT' THEN 0.75
        WHEN 'KAG' THEN 0.75
        WHEN 'NVDAX' THEN 0.65
        WHEN 'TSLAX' THEN 0.65
        WHEN 'OUSG' THEN 0.85
    END as lt,
    CASE collateral.symbol
        WHEN 'BTC' THEN 0.10
        WHEN 'ETH' THEN 0.10
        WHEN 'XAUT' THEN 0.10
        WHEN 'KAG' THEN 0.10
        WHEN 'NVDAX' THEN 0.15
        WHEN 'TSLAX' THEN 0.15
        WHEN 'OUSG' THEN 0.05
    END as lp
FROM assets collateral
CROSS JOIN assets loan
WHERE collateral.is_loan_token = false
  AND loan.is_loan_token = true;

COMMIT;
