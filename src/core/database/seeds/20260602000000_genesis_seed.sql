-- Genesis seed — Arbitrum Sepolia (chainId 421614).
-- Consolidates the four formerly-active seeds:
--   20260120174542_supported_tokens          (11 assets + collateral risk matrix)
--   20260315120000_update_token_images_to_webp (folded in — image_url already .webp)
--   20260324000000_loan_token_collateral_risk  (loan-token-as-collateral risk rows)
--   20260514120000_realign_arb_sepolia_token_addresses (folded in — addresses match)
--
-- NOTE: token_address values are the deployed mock-token addresses and MUST be
-- re-aligned after every contract redeploy — HubDepositor._supportedAssets is the
-- on-chain source of truth; a stale address reverts deposits with UnsupportedAsset.
-- sync-to-services.sh does NOT refresh this table. After a redeploy, realign
-- deterministically from the deployment summary before seeding:
--   pnpm run db realign:assets <smart-contract-revamp/deployments/deploy-<net>-latest.json>
-- (rewrites token_address per symbol from the summary's mockTokens; idempotent).
BEGIN;

-- coingecko_id: CoinGecko coin ID for live prices; NULL for testnet-only tokens.
-- decimals: token decimal places (e.g. 6 for USDC, 18 for ETH).
INSERT INTO assets (id, name, symbol, token_address, is_loan_token, chain_id, coingecko_id, decimals, image_url)
SELECT gen_random_uuid(), v.name, v.symbol, v.token_address, v.is_loan_token, v.chain_id, v.coingecko_id, v.decimals, v.image_url
FROM (VALUES
    ('Bitcoin',                                   'BTC',    '0xcbdA7995F02f77e148aB5Da93fFEc48B0873d94c', false, 421614, 'bitcoin',                                              8,  '/tokens/btc-icon.webp'),
    ('Ethereum',                                  'ETH',    '0xAb92344099cf31F24cc841F194BE53626023aB61', false, 421614, 'ethereum',                                             18, '/tokens/eth-icon.webp'),
    ('Tether Gold',                               'XAUT',   '0x0cCA2904D26686460ABFF0faE5473bd62616ED2A', false, 421614, 'tether-gold',                                          6,  '/tokens/xaut-icon.webp'),
    ('USD Coin',                                  'USDC',   '0x6B8d9A4C6EBC58672c00b7b9CF5f450654f5e1F0', true,  421614, 'usd-coin',                                             6,  '/tokens/usdc-icon.webp'),
    ('Tether USD',                                'USDT',   '0x14e0361FEE0942FfC71ff39a463c8aa023Ae7F55', true,  421614, 'tether',                                               6,  '/tokens/usdt-icon.webp'),
    ('Indonesian Rupiah',                         'IDRX',   '0x6C9Bf300b4B016011993dAB06E9C33c754cd2605', true,  421614, 'idrx',                                                 6,  '/tokens/idrx-icon.webp'),
    ('StraitsX SGD',                              'XSGD',   '0x69cEDC83B6c4b276194Ac2FB43E3956e174C0C09', true,  421614, 'xsgd',                                                 6,  '/tokens/xsgd-icon.webp'),
    ('iShares Silver Trust (Ondo)',               'SLVon',  '0x11e501F57E545a08701dC922aEf311197018c009', false, 421614, 'ishares-silver-trust-ondo-tokenized-stock',            18, '/tokens/slvon-icon.webp'),
    ('NVIDIA (Ondo)',                             'NVDAon', '0xDF5063f2264430bBB4432E053782cb03b6aA1c63', false, 421614, 'nvidia-ondo-tokenized-stock',                          18, '/tokens/nvda-icon.webp'),
    ('Apple (Ondo)',                              'AAPLon', '0x6BF8b95C4C5927b4Baa98B38d83700d5EE2fe74f', false, 421614, 'apple-ondo-tokenized-stock',                           18, '/tokens/aaplon-icon.webp'),
    ('iShares 20+ Year Treasury Bond ETF (Ondo)', 'TLTon',  '0x64df8dC9C85cBcEA9C30c2562bAF3a1B3d038C90', false, 421614, 'ishares-20-year-treasury-bond-etf-ondo-tokenized-etf', 18, '/tokens/tlton-icon.webp')
) AS v(name, symbol, token_address, is_loan_token, chain_id, coingecko_id, decimals, image_url)
WHERE NOT EXISTS (
    SELECT 1 FROM assets a WHERE a.symbol = v.symbol AND a.chain_id = v.chain_id::NUMERIC
);

-- Risk matrix #1: non-loan collateral (BTC/ETH/XAUT/SLVon/NVDAon/AAPLon/TLTon)
-- against every loan token.
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
    END AS ltv,
    CASE collateral.symbol
        WHEN 'BTC' THEN 8000
        WHEN 'ETH' THEN 8000
        WHEN 'XAUT' THEN 7500
        WHEN 'SLVon' THEN 7500
        WHEN 'NVDAon' THEN 6500
        WHEN 'AAPLon' THEN 6500
        WHEN 'TLTon' THEN 8500
    END AS lt,
    CASE collateral.symbol
        WHEN 'BTC' THEN 1000
        WHEN 'ETH' THEN 1000
        WHEN 'XAUT' THEN 1000
        WHEN 'SLVon' THEN 1000
        WHEN 'NVDAon' THEN 1500
        WHEN 'AAPLon' THEN 1500
        WHEN 'TLTon' THEN 500
    END AS lp
FROM assets collateral
CROSS JOIN assets loan
WHERE collateral.is_loan_token = false
  AND loan.is_loan_token = true
ON CONFLICT (collateral_token_id, loan_token_id) DO NOTHING;

-- Risk matrix #2: loan tokens used as collateral for other loan tokens.
-- Same-token pairs (USDC→USDC) get higher LTV (no price risk); cross-stablecoin
-- pairs get slightly lower LTV for peg risk.
INSERT INTO risk (id, collateral_token_id, loan_token_id, ltv, lt, lp)
SELECT
    gen_random_uuid(),
    collateral.id,
    loan.id,
    CASE WHEN collateral.id = loan.id THEN 9000 ELSE 8500 END,
    CASE WHEN collateral.id = loan.id THEN 9300 ELSE 8800 END,
    500
FROM assets collateral
CROSS JOIN assets loan
WHERE collateral.is_loan_token = true
  AND loan.is_loan_token = true
ON CONFLICT (collateral_token_id, loan_token_id) DO NOTHING;

COMMIT;
