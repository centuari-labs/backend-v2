-- Seed: 20260314120000_mock_portfolio_data.sql
-- Populates all portfolio-related tables with mock data for a specific user account.
-- Idempotent: cleans up existing data for this account before inserting.

BEGIN;

DO $$
DECLARE
    test_wallet         TEXT := '0x3907D6c152fDf477b1e53D305020249beeeE57aC';
    test_privy_id       TEXT := 'did:privy:cmmq99io3017q0cldfy4cz8nl';
    test_account_id     UUID;

    btc_id   UUID;
    eth_id   UUID;
    xaut_id  UUID;
    usdc_id  UUID;
    usdt_id  UUID;

    usdc_market_30d_id  UUID;
    usdt_market_60d_id  UUID;
    usdc_market_90d_id  UUID;

    settlement_batch_id UUID := gen_random_uuid();
    cbt_asset_id        UUID := gen_random_uuid();

BEGIN
    -- 1. Resolve account
    SELECT id INTO test_account_id FROM accounts WHERE LOWER(user_wallet) = LOWER(test_wallet);
    IF test_account_id IS NULL THEN
        test_account_id := gen_random_uuid();
        INSERT INTO accounts (id, privy_user_id, user_wallet)
        VALUES (test_account_id, test_privy_id, test_wallet);
    END IF;

    -- 2. Resolve assets
    SELECT id INTO btc_id  FROM assets WHERE symbol = 'BTC'  LIMIT 1;
    SELECT id INTO eth_id  FROM assets WHERE symbol = 'ETH'  LIMIT 1;
    SELECT id INTO xaut_id FROM assets WHERE symbol = 'XAUT' LIMIT 1;
    SELECT id INTO usdc_id FROM assets WHERE symbol = 'USDC' AND is_loan_token = true LIMIT 1;
    SELECT id INTO usdt_id FROM assets WHERE symbol = 'USDT' AND is_loan_token = true LIMIT 1;

    IF usdc_id IS NULL OR usdt_id IS NULL THEN
        RAISE NOTICE 'Required assets not found, skipping mock data seed.';
        RETURN;
    END IF;

    -- 3. Clean up existing data for this account (dependency order)
    DELETE FROM lend_positions WHERE account_id = test_account_id;
    DELETE FROM borrow_positions WHERE account_id = test_account_id;
    DELETE FROM portfolio WHERE account_id = test_account_id;

    -- 4. Ensure Markets (maturities must be 1st-of-month UTC to match market worker)
    -- USDC: 1st of next month
    SELECT id INTO usdc_market_30d_id FROM markets
    WHERE asset_id = usdc_id
      AND maturity = date_trunc('month', NOW()) + INTERVAL '1 month';
    IF usdc_market_30d_id IS NULL THEN
        usdc_market_30d_id := gen_random_uuid();
        INSERT INTO markets (id, asset_id, maturity, created_at)
        VALUES (usdc_market_30d_id, usdc_id, date_trunc('month', NOW()) + INTERVAL '1 month', NOW());
    END IF;

    -- USDT: 1st of month after next
    SELECT id INTO usdt_market_60d_id FROM markets
    WHERE asset_id = usdt_id
      AND maturity = date_trunc('month', NOW()) + INTERVAL '2 months';
    IF usdt_market_60d_id IS NULL THEN
        usdt_market_60d_id := gen_random_uuid();
        INSERT INTO markets (id, asset_id, maturity, created_at)
        VALUES (usdt_market_60d_id, usdt_id, date_trunc('month', NOW()) + INTERVAL '2 months', NOW());
    END IF;

    -- USDC: 1st of 3 months from now
    SELECT id INTO usdc_market_90d_id FROM markets
    WHERE asset_id = usdc_id
      AND maturity = date_trunc('month', NOW()) + INTERVAL '3 months';
    IF usdc_market_90d_id IS NULL THEN
        usdc_market_90d_id := gen_random_uuid();
        INSERT INTO markets (id, asset_id, maturity, created_at)
        VALUES (usdc_market_90d_id, usdc_id, date_trunc('month', NOW()) + INTERVAL '3 months', NOW());
    END IF;

    -- 5. Portfolio holdings (base units)
    -- Targeting ~$15K collateral, ~$8K debt for HF ~1.4

    -- BTC: 0.05 = 5_000_000 (8 decimals) ~$3,540
    IF btc_id IS NOT NULL THEN
        INSERT INTO portfolio (id, account_id, asset_id, amount, is_collateral)
        VALUES (gen_random_uuid(), test_account_id, btc_id, 5000000, true)
        ON CONFLICT (account_id, asset_id) DO UPDATE SET
            amount = EXCLUDED.amount, is_collateral = EXCLUDED.is_collateral, updated_at = NOW();
    END IF;

    -- ETH: 3.5 = 3_500_000_000_000_000_000 (18 decimals) ~$7,270
    IF eth_id IS NOT NULL THEN
        INSERT INTO portfolio (id, account_id, asset_id, amount, is_collateral)
        VALUES (gen_random_uuid(), test_account_id, eth_id, 3500000000000000000, true)
        ON CONFLICT (account_id, asset_id) DO UPDATE SET
            amount = EXCLUDED.amount, is_collateral = EXCLUDED.is_collateral, updated_at = NOW();
    END IF;

    -- XAUT: 1.5 = 1_500_000 (6 decimals) ~$7,495
    IF xaut_id IS NOT NULL THEN
        INSERT INTO portfolio (id, account_id, asset_id, amount, is_collateral)
        VALUES (gen_random_uuid(), test_account_id, xaut_id, 1500000, true)
        ON CONFLICT (account_id, asset_id) DO UPDATE SET
            amount = EXCLUDED.amount, is_collateral = EXCLUDED.is_collateral, updated_at = NOW();
    END IF;

    -- USDC: 5000 = 5_000_000_000 (6 decimals)
    INSERT INTO portfolio (id, account_id, asset_id, amount, is_collateral)
    VALUES (gen_random_uuid(), test_account_id, usdc_id, 5000000000, false)
    ON CONFLICT (account_id, asset_id) DO UPDATE SET
        amount = EXCLUDED.amount, is_collateral = EXCLUDED.is_collateral, updated_at = NOW();

    -- USDT: 2500 = 2_500_000_000 (6 decimals)
    INSERT INTO portfolio (id, account_id, asset_id, amount, is_collateral)
    VALUES (gen_random_uuid(), test_account_id, usdt_id, 2500000000, false)
    ON CONFLICT (account_id, asset_id) DO UPDATE SET
        amount = EXCLUDED.amount, is_collateral = EXCLUDED.is_collateral, updated_at = NOW();

    -- 6. Lend Positions
    -- 5000 USDC: shares > amount to show accrued interest (APR = shares/amount - 1)
    INSERT INTO lend_positions (id, account_id, asset_id, market_id, shares, original_shares, amount, created_at)
    VALUES (gen_random_uuid(), test_account_id, usdc_id, usdc_market_30d_id, 5100000000, 5000000000, 5000000000, NOW() - INTERVAL '10 days');

    -- 3000 USDC: slight interest accrued
    INSERT INTO lend_positions (id, account_id, asset_id, market_id, shares, original_shares, amount, created_at)
    VALUES (gen_random_uuid(), test_account_id, usdc_id, usdc_market_90d_id, 3030000000, 3000000000, 3000000000, NOW() - INTERVAL '5 days');

    -- 7. Borrow Positions
    -- 8000 USDT: debt > original_debt to show accrued interest
    INSERT INTO borrow_positions (id, account_id, asset_id, market_id, amount, original_debt, debt, created_at)
    VALUES (gen_random_uuid(), test_account_id, usdt_id, usdt_market_60d_id, 8000000000, 8000000000, 8200000000, NOW() - INTERVAL '7 days');

    -- 8. Settlement Batch
    INSERT INTO settlement_batches (id, tx_hash, status, created_at)
    VALUES (settlement_batch_id, '0xabc123def456789000000000000000000000000000000000000000000000dead', 'COMPLETED', NOW() - INTERVAL '10 days')
    ON CONFLICT DO NOTHING;

    -- 9. CBT Asset for USDC 30-day market
    IF NOT EXISTS (SELECT 1 FROM cbt_assets WHERE market_id = usdc_market_30d_id) THEN
        INSERT INTO cbt_assets (id, market_id, name, symbol, token_address, settlement_batch_id, created_at)
        VALUES (cbt_asset_id, usdc_market_30d_id, 'CBT USDC 30D', 'cbtUSDC30', '0xCBT0000000000000000000000000000000000001', settlement_batch_id, NOW() - INTERVAL '10 days');
    END IF;

    RAISE NOTICE 'Mock portfolio data seeded for wallet %', test_wallet;
END $$;

COMMIT;
