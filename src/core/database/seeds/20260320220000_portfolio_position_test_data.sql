-- Seed: 20260320220000_portfolio_position_test_data.sql
-- Creates test data for GET /my-position endpoint testing.
-- Includes lend_positions (with shares, amount, apr) and borrow_positions (with amount, debt, apr)
-- to validate baseAmount and shares fields in the response.
-- Idempotent: cleans up existing data for the test account before inserting.

BEGIN;

DO $$
DECLARE
    test_wallet         TEXT := '0x3Ebf8ffC3F1517f9760dD2BfF36f934d19fa6cD8';
    test_privy_id       TEXT := 'did:privy:cmmq99io3017q0cldfy4cz8nl';
    test_account_id     UUID;

    btc_id   UUID;
    eth_id   UUID;
    usdc_id  UUID;
    usdt_id  UUID;

    usdc_market_30d_id  UUID;
    usdc_market_90d_id  UUID;
    usdt_market_60d_id  UUID;

BEGIN
    -- 1. Resolve or create account
    SELECT id INTO test_account_id FROM accounts WHERE LOWER(user_wallet) = LOWER(test_wallet);
    IF test_account_id IS NULL THEN
        test_account_id := gen_random_uuid();
        INSERT INTO accounts (id, privy_user_id, user_wallet)
        VALUES (test_account_id, test_privy_id, test_wallet);
    END IF;

    -- 2. Resolve assets (must exist from supported_tokens seed)
    SELECT id INTO btc_id  FROM assets WHERE symbol = 'BTC'  LIMIT 1;
    SELECT id INTO eth_id  FROM assets WHERE symbol = 'ETH'  LIMIT 1;
    SELECT id INTO usdc_id FROM assets WHERE symbol = 'USDC' AND is_loan_token = true LIMIT 1;
    SELECT id INTO usdt_id FROM assets WHERE symbol = 'USDT' AND is_loan_token = true LIMIT 1;

    IF usdc_id IS NULL OR usdt_id IS NULL THEN
        RAISE NOTICE 'Required assets (USDC/USDT) not found. Run supported_tokens seed first.';
        RETURN;
    END IF;

    -- 3. Clean up existing position data for this account
    DELETE FROM lend_positions   WHERE account_id = test_account_id;
    DELETE FROM borrow_positions WHERE account_id = test_account_id;
    DELETE FROM portfolio        WHERE account_id = test_account_id;

    -- 4. Ensure markets exist
    -- USDC 30-day: maturity = 1st of next month
    SELECT id INTO usdc_market_30d_id FROM markets
    WHERE asset_id = usdc_id AND maturity = date_trunc('month', NOW()) + INTERVAL '1 month';
    IF usdc_market_30d_id IS NULL THEN
        usdc_market_30d_id := gen_random_uuid();
        INSERT INTO markets (id, asset_id, maturity, created_at)
        VALUES (usdc_market_30d_id, usdc_id, date_trunc('month', NOW()) + INTERVAL '1 month', NOW());
    END IF;

    -- USDC 90-day: maturity = 1st of 3 months from now
    SELECT id INTO usdc_market_90d_id FROM markets
    WHERE asset_id = usdc_id AND maturity = date_trunc('month', NOW()) + INTERVAL '3 months';
    IF usdc_market_90d_id IS NULL THEN
        usdc_market_90d_id := gen_random_uuid();
        INSERT INTO markets (id, asset_id, maturity, created_at)
        VALUES (usdc_market_90d_id, usdc_id, date_trunc('month', NOW()) + INTERVAL '3 months', NOW());
    END IF;

    -- USDT 60-day: maturity = 1st of 2 months from now
    SELECT id INTO usdt_market_60d_id FROM markets
    WHERE asset_id = usdt_id AND maturity = date_trunc('month', NOW()) + INTERVAL '2 months';
    IF usdt_market_60d_id IS NULL THEN
        usdt_market_60d_id := gen_random_uuid();
        INSERT INTO markets (id, asset_id, maturity, created_at)
        VALUES (usdt_market_60d_id, usdt_id, date_trunc('month', NOW()) + INTERVAL '2 months', NOW());
    END IF;

    -- 5. Portfolio holdings (collateral + available balances)
    --    BTC: 0.05 BTC = 5_000_000 (8 decimals) as collateral
    IF btc_id IS NOT NULL THEN
        INSERT INTO portfolio (id, account_id, asset_id, amount, is_collateral)
        VALUES (gen_random_uuid(), test_account_id, btc_id, 5000000, true);
    END IF;

    --    ETH: 3.5 ETH = 3_500_000_000_000_000_000 (18 decimals) as collateral
    IF eth_id IS NOT NULL THEN
        INSERT INTO portfolio (id, account_id, asset_id, amount, is_collateral)
        VALUES (gen_random_uuid(), test_account_id, eth_id, 3500000000000000000, true);
    END IF;

    --    USDC: 5000 = 5_000_000_000 (6 decimals) available balance
    INSERT INTO portfolio (id, account_id, asset_id, amount, is_collateral)
    VALUES (gen_random_uuid(), test_account_id, usdc_id, 5000000000, false);

    --    USDT: 2500 = 2_500_000_000 (6 decimals) available balance
    INSERT INTO portfolio (id, account_id, asset_id, amount, is_collateral)
    VALUES (gen_random_uuid(), test_account_id, usdt_id, 2500000000, false);

    -- 6. Lend Positions
    --    These exercise the new baseAmount + shares fields:
    --    - shares  = current value of the position (what the response returns as "shares")
    --    - amount  = original principal lent (what the response returns as "baseAmount")
    --    - apr     = annual rate in basis points (508 = 5.08%)

    --    Position A: 5000 USDC lent, shares grew to 5100 (2% interest accrued)
    --    Expected response: shares=5100 (human), baseAmount=5000 (human)
    INSERT INTO lend_positions (id, account_id, asset_id, market_id, shares, original_shares, amount, apr, created_at)
    VALUES (
        gen_random_uuid(), test_account_id, usdc_id, usdc_market_30d_id,
        5100000000,    -- shares: 5100 USDC (6 decimals)
        5000000000,    -- original_shares: 5000 USDC
        5000000000,    -- amount (baseAmount): 5000 USDC principal
        508,           -- apr: 5.08%
        NOW() - INTERVAL '15 days'
    );

    --    Position B: 3000 USDC lent, shares grew to 3030 (1% interest accrued)
    --    Expected response: shares=3030 (human), baseAmount=3000 (human)
    INSERT INTO lend_positions (id, account_id, asset_id, market_id, shares, original_shares, amount, apr, created_at)
    VALUES (
        gen_random_uuid(), test_account_id, usdc_id, usdc_market_90d_id,
        3030000000,    -- shares: 3030 USDC
        3000000000,    -- original_shares: 3000 USDC
        3000000000,    -- amount (baseAmount): 3000 USDC principal
        350,           -- apr: 3.50%
        NOW() - INTERVAL '5 days'
    );

    -- 7. Borrow Positions
    --    - debt    = current outstanding debt (what the response returns as "shares")
    --    - amount  = original borrowed amount (what the response returns as "baseAmount")
    --    NOTE: shares/original_shares columns were dropped (migration 20260215)

    --    Position C: Borrowed 8000 USDT, debt grew to 8200 (2.5% interest accrued)
    --    Expected response: shares=8200 (human), baseAmount=8000 (human)
    INSERT INTO borrow_positions (id, account_id, asset_id, market_id, amount, original_debt, debt, apr, created_at)
    VALUES (
        gen_random_uuid(), test_account_id, usdt_id, usdt_market_60d_id,
        8000000000,    -- amount (baseAmount): 8000 USDT principal
        8000000000,    -- original_debt: 8000 USDT
        8200000000,    -- debt: 8200 USDT (current outstanding)
        625,           -- apr: 6.25%
        NOW() - INTERVAL '10 days'
    );

    --    Position D: Borrowed 2000 USDC, debt grew to 2040 (2% interest accrued)
    --    Expected response: shares=2040 (human), baseAmount=2000 (human)
    INSERT INTO borrow_positions (id, account_id, asset_id, market_id, amount, original_debt, debt, apr, created_at)
    VALUES (
        gen_random_uuid(), test_account_id, usdc_id, usdc_market_30d_id,
        2000000000,    -- amount (baseAmount): 2000 USDC principal
        2000000000,    -- original_debt: 2000 USDC
        2040000000,    -- debt: 2040 USDC (current outstanding)
        480,           -- apr: 4.80%
        NOW() - INTERVAL '7 days'
    );

    RAISE NOTICE 'Portfolio position test data seeded for wallet %', test_wallet;
    RAISE NOTICE 'Expected GET /my-position response:';
    RAISE NOTICE '  LEND  USDC 30d: shares=5100, baseAmount=5000, apr=5.08';
    RAISE NOTICE '  LEND  USDC 90d: shares=3030, baseAmount=3000, apr=3.50';
    RAISE NOTICE '  BORROW USDT 60d: shares=8200, baseAmount=8000, apr=6.25';
    RAISE NOTICE '  BORROW USDC 30d: shares=2040, baseAmount=2000, apr=4.80';
END $$;

COMMIT;
