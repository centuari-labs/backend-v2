-- Seed: 20260120174542_supported_tokens.sql
BEGIN;

-- coingecko_id: CoinGecko coin ID for live prices; NULL for testnet-only tokens
-- decimals: Token decimal places for amount conversion (e.g. 6 for USDC, 18 for ETH)
INSERT INTO assets (name, symbol, token_address, is_loan_token, chain_id, coingecko_id, decimals) VALUES
    ('Bitcoin', 'BTC', '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', false, 84532, 'bitcoin', 8),
    ('Ethereum', 'ETH', '0x4200000000000000000000000000000000000006', false, 84532, 'ethereum', 18),
    ('Tether Gold', 'XAUT', '0x0000000000000000000000000000000000000003', false, 84532, 'tether-gold', 6),
    ('USD Coin', 'USDC', '0x036CbD53842c5426634e7929541eC2318f3dCF7e', true, 84532, 'usd-coin', 6),
    ('Tether USD', 'USDT', '0x0000000000000000000000000000000000000007', true, 84532, 'tether', 6),
    ('Indonesian Rupiah', 'IDRX', '0x18Bc5bcC660cf2B9cE3cd51a404aFe1a0cBD3C22', true, 84532, 'idrx', 18),
    ('StraitsX SGD', 'XSGD', '0x0000000000000000000000000000000000000006', true, 84532, 'xsgd', 6),
    ('iShares Silver Trust (Ondo Tokenized)', 'SLVon', '0x0000000000000000000000000000000000000008', false, 84532, 'ishares-silver-trust-ondo-tokenized-stock', 18),
    ('NVIDIA (Ondo Tokenized)', 'NVDAon', '0x0000000000000000000000000000000000000009', false, 84532, 'nvidia-ondo-tokenized-stock', 18),
    ('Apple (Ondo Tokenized)', 'AAPLon', '0x000000000000000000000000000000000000000a', false, 84532, 'apple-ondo-tokenized-stock', 18),
    ('iShares 20+ Year Treasury Bond ETF (Ondo Tokenized)', 'TLTon', '0x000000000000000000000000000000000000000b', false, 84532, 'ishares-20-year-treasury-bond-etf-ondo-tokenized-etf', 18);

-- Collateral tokens: BTC, ETH, XAUT, SLVon, NVDAon, AAPLon, TLTon
-- Loan tokens: USDC, USDT, IDRX, XSGD
INSERT INTO risk (collateral_token_id, loan_token_id, ltv, lt, lp)
SELECT 
    collateral.id,
    loan.id,
    CASE collateral.symbol
        WHEN 'BTC' THEN 7500
        WHEN 'ETH' THEN 7500
        WHEN 'XAUT' THEN 7000
        WHEN 'SLVon' THEN 7000
        WHEN 'NVDAon' THEN 6000
        WHEN 'AAPLon' THEN 6000
        WHEN 'TLTon' THEN 8000
    END as ltv,
    CASE collateral.symbol
        WHEN 'BTC' THEN 8000
        WHEN 'ETH' THEN 8000
        WHEN 'XAUT' THEN 7500
        WHEN 'SLVon' THEN 7500
        WHEN 'NVDAon' THEN 6500
        WHEN 'AAPLon' THEN 6500
        WHEN 'TLTon' THEN 8500
    END as lt,
    CASE collateral.symbol
        WHEN 'BTC' THEN 1000
        WHEN 'ETH' THEN 1000
        WHEN 'XAUT' THEN 1000
        WHEN 'SLVon' THEN 1000
        WHEN 'NVDAon' THEN 1500
        WHEN 'AAPLon' THEN 1500
        WHEN 'TLTon' THEN 500
    END as lp
FROM assets collateral
CROSS JOIN assets loan
WHERE collateral.is_loan_token = false
  AND loan.is_loan_token = true
  AND collateral.symbol IN ('BTC', 'ETH', 'XAUT', 'SLVon', 'NVDAon', 'AAPLon', 'TLTon');

COMMIT;
