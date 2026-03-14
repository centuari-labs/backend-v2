-- Seed: 20260211140000_portfolio_extended_seed.sql

BEGIN;

DO $$
DECLARE
    test_account_id UUID;
    counterparty_account_id UUID;
    btc_id UUID;
    eth_id UUID;
    usdc_id UUID;
    usdt_id UUID;
    usdc_market_id UUID;
    usdt_market_id UUID;
    test_wallet TEXT := '0x71C7656EC7ab88b098defB751B7401B5f6d8976F';
    
    usdc_lend_order_id UUID := gen_random_uuid();
    usdc_borrow_order_id UUID := gen_random_uuid();
    usdc_match_id UUID := gen_random_uuid();

BEGIN
    IF NOT EXISTS (SELECT 1 FROM accounts WHERE user_wallet = test_wallet) THEN
        INSERT INTO accounts (id, privy_user_id, user_wallet)
        VALUES (gen_random_uuid(), 'did:privy:cm1234567890', test_wallet);
    END IF;
    SELECT id INTO test_account_id FROM accounts WHERE user_wallet = test_wallet;

    -- Create a counterparty for matches
    IF NOT EXISTS (SELECT 1 FROM accounts WHERE user_wallet = '0x0000000000000000000000000000000000000001') THEN
        INSERT INTO accounts (id, privy_user_id, user_wallet)
        VALUES (gen_random_uuid(), 'did:privy:counterparty', '0x0000000000000000000000000000000000000001');
    END IF;
    SELECT id INTO counterparty_account_id FROM accounts WHERE user_wallet = '0x0000000000000000000000000000000000000001';

    -- 2. Fetch Asset IDs
    SELECT id INTO btc_id FROM assets WHERE symbol = 'BTC' LIMIT 1;
    SELECT id INTO eth_id FROM assets WHERE symbol = 'ETH' LIMIT 1;
    SELECT id INTO usdc_id FROM assets WHERE symbol = 'USDC' AND is_loan_token = true LIMIT 1;
    SELECT id INTO usdt_id FROM assets WHERE symbol = 'USDT' AND is_loan_token = true LIMIT 1;

    -- 3. Clean up
    DELETE FROM settlement_items WHERE match_id IN (SELECT id FROM matches WHERE lender_account_id = test_account_id OR borrower_account_id = test_account_id);
    DELETE FROM matches WHERE lender_account_id = test_account_id OR borrower_account_id = test_account_id;
    DELETE FROM borrow_positions WHERE account_id = test_account_id;
    DELETE FROM lend_positions WHERE account_id = test_account_id;
    DELETE FROM order_markets WHERE order_id IN (SELECT id FROM orders WHERE account_id = test_account_id);
    DELETE FROM orders WHERE account_id = test_account_id;
    DELETE FROM portfolio WHERE account_id = test_account_id;

    -- 4. Ensure Markets
    IF usdc_id IS NOT NULL THEN
        IF NOT EXISTS(SELECT 1 FROM markets WHERE asset_id = usdc_id) THEN
            usdc_market_id := gen_random_uuid();
            INSERT INTO markets (id, asset_id, maturity, created_at) VALUES (usdc_market_id, usdc_id, now() + interval '30 days', now());
        ELSE
            SELECT id INTO usdc_market_id FROM markets WHERE asset_id = usdc_id LIMIT 1;
        END IF;
    END IF;

    IF usdt_id IS NOT NULL THEN
        IF NOT EXISTS(SELECT 1 FROM markets WHERE asset_id = usdt_id) THEN
            usdt_market_id := gen_random_uuid();
            INSERT INTO markets (id, asset_id, maturity, created_at) VALUES (usdt_market_id, usdt_id, now() + interval '60 days', now());
        ELSE
            SELECT id INTO usdt_market_id FROM markets WHERE asset_id = usdt_id LIMIT 1;
        END IF;
    END IF;

    -- 5. Portfolio (Collateral & Balances) — amounts in base units
    --    BTC: 8 decimals, ETH: 18 decimals, USDC: 6 decimals
    IF btc_id IS NOT NULL THEN
        -- 0.0001 BTC = 10000 base units (8 decimals)
        INSERT INTO portfolio (id, account_id, asset_id, amount, is_collateral)
        VALUES (gen_random_uuid(), test_account_id, btc_id, 10000, true);
    END IF;
    IF eth_id IS NOT NULL THEN
        -- 0.0005 ETH = 500000000000000 base units (18 decimals)
        INSERT INTO portfolio (id, account_id, asset_id, amount, is_collateral)
        VALUES (gen_random_uuid(), test_account_id, eth_id, 500000000000000, true);
    END IF;
    IF usdc_id IS NOT NULL THEN
        -- 50 USDC = 50000000 base units (6 decimals)
        INSERT INTO portfolio (id, account_id, asset_id, amount, is_collateral)
        VALUES (gen_random_uuid(), test_account_id, usdc_id, 50000000, false);
    END IF;

    -- 6. Simulated Match Data — active loans
    IF usdc_market_id IS NOT NULL THEN
        -- 500 USDC = 500000000 base units (6 decimals)
        INSERT INTO orders (id, account_id, asset_id, side, type, rate, quantity, filled_quantity, settlement_fee, status)
        VALUES (usdc_lend_order_id, test_account_id, usdc_id, 'LEND', 'LIMIT', 4.5, 500000000, 500000000, 0, 'FILLED');

        INSERT INTO order_markets (order_market_id, order_id, market_id)
        VALUES (usdc_lend_order_id, usdc_lend_order_id, usdc_market_id);

        INSERT INTO orders (id, account_id, asset_id, side, type, rate, quantity, filled_quantity, settlement_fee, status)
        VALUES (usdc_borrow_order_id, counterparty_account_id, usdc_id, 'BORROW', 'LIMIT', 4.5, 500000000, 500000000, 0, 'FILLED');

        INSERT INTO order_markets (order_market_id, order_id, market_id)
        VALUES (usdc_borrow_order_id, usdc_borrow_order_id, usdc_market_id);

        INSERT INTO matches (id, lend_order_market_id, borrow_order_market_id, asset_id, lender_account_id, borrower_account_id, match_amount, rate, is_borrower_taker, maker_fee, taker_fee, lender_settlement_fee, borrower_settlement_fee, maturity)
        VALUES (usdc_match_id, usdc_lend_order_id, usdc_borrow_order_id, usdc_id, test_account_id, counterparty_account_id, 500000000, 4.5, true, 0, 0, 0, 0, now() + interval '30 days');

        -- 7. Lend position — 500 USDC active loan
        INSERT INTO lend_positions (id, account_id, asset_id, market_id, shares, original_shares, amount, created_at)
        VALUES (gen_random_uuid(), test_account_id, usdc_id, usdc_market_id, 500000000, 500000000, 500000000, now());
    END IF;

    IF usdt_market_id IS NOT NULL THEN
        -- Borrow position — 200 USDT = 200000000 base units (6 decimals)
        INSERT INTO borrow_positions (id, account_id, asset_id, market_id, amount, original_debt, debt, created_at)
        VALUES (gen_random_uuid(), test_account_id, usdt_id, usdt_market_id, 200000000, 200000000, 200000000, now());
    END IF;

    -- 8. Open Orders — 10 USDC each = 10000000 base units
    FOR i IN 1..5 LOOP
        IF usdc_id IS NOT NULL THEN
            INSERT INTO orders (id, account_id, asset_id, side, type, rate, quantity, filled_quantity, settlement_fee, status, created_at)
            VALUES (gen_random_uuid(), test_account_id, usdc_id, 'LEND', 'LIMIT', 4.8 + (i * 0.1), 10000000, 0, 0, 'OPEN', now() - (i || ' minutes')::interval);
        END IF;
    END LOOP;

END $$;

COMMIT;
