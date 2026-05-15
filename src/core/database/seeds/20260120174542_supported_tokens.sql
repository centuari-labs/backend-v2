-- Seed: 20260120174542_supported_tokens.sql
BEGIN;

-- coingecko_id: CoinGecko coin ID for live prices; NULL for testnet-only tokens
-- decimals: Token decimal places for amount conversion (e.g. 6 for USDC, 18 for ETH)
INSERT INTO assets (id, name, symbol, token_address, is_loan_token, chain_id, coingecko_id, decimals, image_url)
SELECT gen_random_uuid(), v.name, v.symbol, v.token_address, v.is_loan_token, v.chain_id, v.coingecko_id, v.decimals, v.image_url
FROM (VALUES
    ('Bitcoin',                                                'BTC',    '0x73Bc0536aDF10110233e67D1bdd98580A5255494', false, 421614, 'bitcoin',                                          8,  '/tokens/btc-icon.webp'),
    ('Ethereum',                                               'ETH',    '0x22BEE7B9f4DC7923190B3e3BE795f5905c62F00c', false, 421614, 'ethereum',                                         18, '/tokens/eth-icon.webp'),
    ('Tether Gold',                                            'XAUT',   '0x2544Ce3FF3540EEeADBB6FA19709b8fAd83441F4', false, 421614, 'tether-gold',                                      6,  '/tokens/xaut-icon.webp'),
    ('USD Coin',                                               'USDC',   '0x218A9082C712FA709c044a6cea6Ef333df04cc3d', true,  421614, 'usd-coin',                                         6,  '/tokens/usdc-icon.webp'),
    ('Tether USD',                                             'USDT',   '0xc3Ab74D13A2b03d66E9b5a5Eda8b3F2Fea52Fc12', true,  421614, 'tether',                                           6,  '/tokens/usdt-icon.webp'),
    ('Indonesian Rupiah',                                      'IDRX',   '0x86B3405275F5fCb90f98a12C18E619f134F6521a', true,  421614, 'idrx',                                             6, '/tokens/idrx-icon.webp'),
    ('StraitsX SGD',                                           'XSGD',   '0x9aeDd0ff1178e33Ad6d30F858ddB98115F9c0293', true,  421614, 'xsgd',                                             6,  '/tokens/xsgd-icon.webp'),
    ('iShares Silver Trust (Ondo)',                            'SLVon',  '0x47757F5C6109032019a8316F3550A1F5Dd2196D9', false, 421614, 'ishares-silver-trust-ondo-tokenized-stock',         18, '/tokens/slvon-icon.webp'),
    ('NVIDIA (Ondo)',                                          'NVDAon', '0x75f23E36c2011d8AD580b5D62Ed131c58F2D7FE2', false, 421614, 'nvidia-ondo-tokenized-stock',                      18, '/tokens/nvda-icon.webp'),
    ('Apple (Ondo)',                                           'AAPLon', '0x9f4aCe64eB5Aa003c39F85ab10EE3d2f0f102A34', false, 421614, 'apple-ondo-tokenized-stock',                       18, '/tokens/aaplon-icon.webp'),
    ('iShares 20+ Year Treasury Bond ETF (Ondo)',              'TLTon',  '0x8A7d5D4A1B7feFb055930d4D9e8d6A92c068414f', false, 421614, 'ishares-20-year-treasury-bond-etf-ondo-tokenized-etf', 18, '/tokens/tlton-icon.webp')
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
