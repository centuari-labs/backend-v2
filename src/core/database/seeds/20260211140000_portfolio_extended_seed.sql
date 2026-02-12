-- Seed: 20260211140000_portfolio_extended_seed.sql
BEGIN;

DO $$
DECLARE
    test_account_id UUID;
    btc_id UUID;
    eth_id UUID;
    usdc_id UUID;
    usdt_id UUID;
    test_wallet TEXT := '0x71C7656EC7ab88b098defB751B7401B5f6d8976F';
    i INTEGER;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM accounts WHERE user_wallet = test_wallet) THEN
        INSERT INTO accounts (privy_user_id, user_wallet)
        VALUES ('did:privy:cm1234567890', test_wallet);
    END IF;

    SELECT id INTO test_account_id FROM accounts WHERE user_wallet = test_wallet;

    SELECT id INTO btc_id FROM assets WHERE symbol = 'BTC' LIMIT 1;
    SELECT id INTO eth_id FROM assets WHERE symbol = 'ETH' LIMIT 1;
    SELECT id INTO usdc_id FROM assets WHERE symbol = 'USDC' LIMIT 1;
    SELECT id INTO usdt_id FROM assets WHERE symbol = 'USDT' LIMIT 1;

    -- Clean up existing data for test account
    DELETE FROM settlement_items WHERE match_id IN (SELECT id FROM matches WHERE lender_account_id = test_account_id OR borrower_account_id = test_account_id);
    DELETE FROM matches WHERE lender_account_id = test_account_id OR borrower_account_id = test_account_id;
    DELETE FROM borrow_positions WHERE account_id = test_account_id;
    DELETE FROM lend_positions WHERE account_id = test_account_id;
    DELETE FROM order_markets WHERE order_id IN (SELECT id FROM orders WHERE account_id = test_account_id);
    DELETE FROM orders WHERE account_id = test_account_id;
    DELETE FROM portfolio WHERE account_id = test_account_id;
    
    -- Ensure Markets exist for assets (required for positions)
    -- We'll use a deterministic UUID generation or check existence to avoid duplicates if re-run without full clean
    
    -- Create markets if they don't exist
    IF usdc_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM markets WHERE asset_id = usdc_id) THEN
        INSERT INTO markets (id, asset_id, created_at) VALUES (gen_random_uuid(), usdc_id, now());
    END IF;
    
    IF eth_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM markets WHERE asset_id = eth_id) THEN
        INSERT INTO markets (id, asset_id, created_at) VALUES (gen_random_uuid(), eth_id, now());
    END IF;

    IF btc_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM markets WHERE asset_id = btc_id) THEN
        INSERT INTO markets (id, asset_id, created_at) VALUES (gen_random_uuid(), btc_id, now());
    END IF;

    -- Portfolio (Wallet Balances)
    IF usdc_id IS NOT NULL THEN
        -- Large USDC balance
        INSERT INTO portfolio (id, account_id, asset_id, amount, is_collateral)
        VALUES (gen_random_uuid(), test_account_id, usdc_id, 50000.0, true);
    END IF;

    IF btc_id IS NOT NULL THEN
        -- Some BTC
        INSERT INTO portfolio (id, account_id, asset_id, amount, is_collateral)
        VALUES (gen_random_uuid(), test_account_id, btc_id, 0.5, true);
    END IF;

    IF eth_id IS NOT NULL THEN
        -- Some ETH
        INSERT INTO portfolio (id, account_id, asset_id, amount, is_collateral)
        VALUES (gen_random_uuid(), test_account_id, eth_id, 5.0, true);
    END IF;

    -- Lend Positions (Supplied Assets)
    -- Supplying 10,000 USDC
    IF usdc_id IS NOT NULL THEN
        INSERT INTO lend_positions (id, account_id, asset_id, market_id, shares, original_shares, amount, created_at)
        SELECT 
            gen_random_uuid(), 
            test_account_id, 
            usdc_id, 
            id, -- market_id
            10000.0, -- shares
            10000.0, -- original_shares
            10000.0, -- amount
            now()
        FROM markets WHERE asset_id = usdc_id LIMIT 1;
    END IF;

    -- Supplying 2 ETH
    IF eth_id IS NOT NULL THEN
        INSERT INTO lend_positions (id, account_id, asset_id, market_id, shares, original_shares, amount, created_at)
        SELECT 
            gen_random_uuid(), 
            test_account_id, 
            eth_id, 
            id, 
            2.0, 
            2.0, 
            2.0, 
            now()
        FROM markets WHERE asset_id = eth_id LIMIT 1;
    END IF;

    -- Borrow Positions (Borrowed Assets)
    -- Borrowing 1,000 USDC
    IF usdc_id IS NOT NULL THEN
        INSERT INTO borrow_positions (id, account_id, asset_id, market_id, shares, original_shares, amount, original_debt, debt, created_at)
        SELECT 
            gen_random_uuid(), 
            test_account_id, 
            usdc_id, 
            id, 
            1000.0, -- shares
            1000.0, -- original_shares
            1000.0, -- amount (principal)
            1000.0, -- original_debt
            1000.0, -- debt (current debt including interest)
            now()
        FROM markets WHERE asset_id = usdc_id LIMIT 1;
    END IF;

    -- Borrowing 0.1 BTC
    IF btc_id IS NOT NULL THEN
        INSERT INTO borrow_positions (id, account_id, asset_id, market_id, shares, original_shares, amount, original_debt, debt, created_at)
        SELECT 
            gen_random_uuid(), 
            test_account_id, 
            btc_id, 
            id, 
            0.1, 
            0.1, 
            0.1, 
            0.1, 
            0.1, 
            now()
        FROM markets WHERE asset_id = btc_id LIMIT 1;
    END IF;


    FOR i IN 1..20 LOOP
        IF i % 3 = 1 THEN
            INSERT INTO orders (account_id, asset_id, side, type, rate, quantity, filled_quantity, settlement_fee, status, created_at)
            VALUES (test_account_id, usdc_id, 'LEND', 'LIMIT', 4.35, 500.0, 0, 0.0, 'OPEN', now() - (i || ' minutes')::interval);
        ELSIF i % 3 = 2 THEN
            INSERT INTO orders (account_id, asset_id, side, type, rate, quantity, filled_quantity, settlement_fee, status, created_at)
            VALUES (test_account_id, usdc_id, 'LEND', 'LIMIT', 4.35, 600.0, 0, 0.0, 'OPEN', now() - (i || ' minutes')::interval);
        ELSE
            INSERT INTO orders (account_id, asset_id, side, type, rate, quantity, filled_quantity, settlement_fee, status, created_at)
            VALUES (test_account_id, eth_id, 'LEND', 'LIMIT', 4.35, 2.0, 0, 0.0, 'OPEN', now() - (i || ' minutes')::interval);
        END IF;
    END LOOP;

END $$;

COMMIT;
