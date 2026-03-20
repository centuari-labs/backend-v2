-- Seed: 20260120174542_supported_tokens.sql
BEGIN;

-- coingecko_id: CoinGecko coin ID for live prices; NULL for testnet-only tokens
-- decimals: Token decimal places for amount conversion (e.g. 6 for USDC, 18 for ETH)
INSERT INTO assets (id, name, symbol, token_address, is_loan_token, chain_id, coingecko_id, decimals, image_url)
SELECT gen_random_uuid(), v.name, v.symbol, v.token_address, v.is_loan_token, v.chain_id, v.coingecko_id, v.decimals, v.image_url
FROM (VALUES
    ('Bitcoin',                                                'BTC',    '0xc2EFd38075d80e0bEfa7F4343c1102344B9aD44c', false, 421614, 'bitcoin',                                          8,  '/tokens/btc-icon.webp'),
    ('Ethereum',                                               'ETH',    '0x80E70a7949f9657729d09e144f65812b90E16Cb4', false, 421614, 'ethereum',                                         18, '/tokens/eth-icon.webp'),
    ('Tether Gold',                                            'XAUT',   '0x09da5F9853d10E0241f717800f255e24Ec797469', false, 421614, 'tether-gold',                                      6,  '/tokens/xaut-icon.webp'),
    ('USD Coin',                                               'USDC',   '0x26970F990252306AFa328B2c91225605c0862498', true,  421614, 'usd-coin',                                         6,  '/tokens/usdc-icon.webp'),
    ('Tether USD',                                             'USDT',   '0xe1e9f8aDFBee861d1173850d692dD3863B7f2b61', true,  421614, 'tether',                                           6,  '/tokens/usdt-icon.webp'),
    ('Indonesian Rupiah',                                      'IDRX',   '0xDB0683a2A3d85B07f35F7eD4413E88C28Da26C7C', true,  421614, 'idrx',                                             6, '/tokens/idrx-icon.webp'),
    ('StraitsX SGD',                                           'XSGD',   '0x612CFED4026384AF12c573A64F4d2996620D911e', true,  421614, 'xsgd',                                             6,  '/tokens/xsgd-icon.webp'),
    ('iShares Silver Trust (Ondo)',                            'SLVon',  '0x1E202e2Ffc478C408cc5A13663a0390ee5a416E2', false, 421614, 'ishares-silver-trust-ondo-tokenized-stock',         18, '/tokens/slvon-icon.webp'),
    ('NVIDIA (Ondo)',                                          'NVDAon', '0x35a0291104408e9eeC3e343583A7b1aD8c7A5496', false, 421614, 'nvidia-ondo-tokenized-stock',                      18, '/tokens/nvda-icon.webp'),
    ('Apple (Ondo)',                                           'AAPLon', '0xf554E2813B5959B6896aDc650231b76d716F3812', false, 421614, 'apple-ondo-tokenized-stock',                       18, '/tokens/aaplon-icon.webp'),
    ('iShares 20+ Year Treasury Bond ETF (Ondo)',              'TLTon',  '0xf6c3b7Db9cdAA6429D62C040bFF3Ff3c443c1EEf', false, 421614, 'ishares-20-year-treasury-bond-etf-ondo-tokenized-etf', 18, '/tokens/tlton-icon.webp')
) AS v(name, symbol, token_address, is_loan_token, chain_id, coingecko_id, decimals, image_url)
WHERE NOT EXISTS (
    SELECT 1 FROM assets a WHERE a.symbol = v.symbol AND a.chain_id = v.chain_id::NUMERIC
);

INSERT INTO risk (id, collateral_token_id, loan_token_id, ltv, lt, lp)
SELECT 
    gen_random_uuid(),
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
  AND loan.is_loan_token = true;

COMMIT;
