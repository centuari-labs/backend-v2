-- Seed: 20260314120000_mock_portfolio_data.sql
-- Populates all portfolio-related tables with mock data for a specific user account.
-- Idempotent: cleans up existing data for this account before inserting.

BEGIN;

DO $$
DECLARE
    test_wallet         TEXT := '0x3907D6c152fDf477b1e53D305020249beeeE57aC';
    test_privy_id       TEXT := 'did:privy:cmmq99io3017q0cldfy4cz8nl';
    test_account_id     UUID;

    counterparty_wallet TEXT := '0x0000000000000000000000000000000000000002';
    counterparty_id     UUID;

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

    -- Order IDs (need references for order_markets and matches)
    lend_order_1_id     UUID := gen_random_uuid();  -- USDC 5000 FILLED
    lend_order_2_id     UUID := gen_random_uuid();  -- USDC 3000 FILLED
    borrow_order_cp_1   UUID := gen_random_uuid();  -- counterparty USDC borrow 5000
    borrow_order_cp_2   UUID := gen_random_uuid();  -- counterparty USDC borrow 3000
    borrow_order_user   UUID := gen_random_uuid();  -- user USDT borrow 8000
    lend_order_cp_usdt  UUID := gen_random_uuid();  -- counterparty USDT lend 8000

    open_lend_1         UUID := gen_random_uuid();
    open_lend_2         UUID := gen_random_uuid();
    open_lend_3         UUID := gen_random_uuid();
    open_borrow_1       UUID := gen_random_uuid();
    open_borrow_2       UUID := gen_random_uuid();
    partial_lend        UUID := gen_random_uuid();

    -- Order-market IDs (same as order IDs for simplicity, following existing pattern)
    om_lend_1           UUID := gen_random_uuid();
    om_lend_2           UUID := gen_random_uuid();
    om_borrow_cp_1      UUID := gen_random_uuid();
    om_borrow_cp_2      UUID := gen_random_uuid();
    om_borrow_user      UUID := gen_random_uuid();
    om_lend_cp_usdt     UUID := gen_random_uuid();

    match_1_id          UUID := gen_random_uuid();
    match_2_id          UUID := gen_random_uuid();
    match_3_id          UUID := gen_random_uuid();

BEGIN
    -- 1. Resolve account
    SELECT id INTO test_account_id FROM accounts WHERE LOWER(user_wallet) = LOWER(test_wallet);
    IF test_account_id IS NULL THEN
        test_account_id := gen_random_uuid();
        INSERT INTO accounts (id, privy_user_id, user_wallet)
        VALUES (test_account_id, test_privy_id, test_wallet);
    END IF;

    -- Counterparty
    IF NOT EXISTS (SELECT 1 FROM accounts WHERE LOWER(user_wallet) = LOWER(counterparty_wallet)) THEN
        INSERT INTO accounts (id, privy_user_id, user_wallet)
        VALUES (gen_random_uuid(), 'did:privy:mock-counterparty', counterparty_wallet);
    END IF;
    SELECT id INTO counterparty_id FROM accounts WHERE LOWER(user_wallet) = LOWER(counterparty_wallet);

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
    DELETE FROM settlement_items WHERE match_id IN (
        SELECT id FROM matches WHERE lender_account_id = test_account_id OR borrower_account_id = test_account_id
    );
    DELETE FROM matches WHERE lender_account_id = test_account_id OR borrower_account_id = test_account_id;
    DELETE FROM lend_positions WHERE account_id = test_account_id;
    DELETE FROM borrow_positions WHERE account_id = test_account_id;
    DELETE FROM order_markets WHERE order_id IN (SELECT id FROM orders WHERE account_id = test_account_id);
    DELETE FROM order_markets WHERE order_id IN (SELECT id FROM orders WHERE account_id = counterparty_id);
    DELETE FROM orders WHERE account_id = test_account_id;
    DELETE FROM orders WHERE account_id = counterparty_id;
    DELETE FROM portfolio WHERE account_id = test_account_id;

    -- 4. Ensure Markets
    -- USDC 30-day
    SELECT id INTO usdc_market_30d_id FROM markets WHERE asset_id = usdc_id AND maturity > NOW() ORDER BY maturity ASC LIMIT 1;
    IF usdc_market_30d_id IS NULL THEN
        usdc_market_30d_id := gen_random_uuid();
        INSERT INTO markets (id, asset_id, maturity, created_at)
        VALUES (usdc_market_30d_id, usdc_id, NOW() + INTERVAL '30 days', NOW());
    END IF;

    -- USDT 60-day
    SELECT id INTO usdt_market_60d_id FROM markets WHERE asset_id = usdt_id AND maturity > NOW() ORDER BY maturity ASC LIMIT 1;
    IF usdt_market_60d_id IS NULL THEN
        usdt_market_60d_id := gen_random_uuid();
        INSERT INTO markets (id, asset_id, maturity, created_at)
        VALUES (usdt_market_60d_id, usdt_id, NOW() + INTERVAL '60 days', NOW());
    END IF;

    -- USDC 90-day
    SELECT id INTO usdc_market_90d_id FROM markets WHERE asset_id = usdc_id AND maturity > NOW() ORDER BY maturity DESC LIMIT 1;
    IF usdc_market_90d_id = usdc_market_30d_id OR usdc_market_90d_id IS NULL THEN
        usdc_market_90d_id := gen_random_uuid();
        INSERT INTO markets (id, asset_id, maturity, created_at)
        VALUES (usdc_market_90d_id, usdc_id, NOW() + INTERVAL '90 days', NOW());
    END IF;

    -- 5. Portfolio holdings (base units)
    -- Targeting ~$15K collateral, ~$8K debt for HF ~1.4

    -- BTC: 0.05 = 5_000_000 (8 decimals) ~$3,540
    IF btc_id IS NOT NULL THEN
        INSERT INTO portfolio (id, account_id, asset_id, amount, is_collateral)
        VALUES (gen_random_uuid(), test_account_id, btc_id, 5000000, true);
    END IF;

    -- ETH: 3.5 = 3_500_000_000_000_000_000 (18 decimals) ~$7,270
    IF eth_id IS NOT NULL THEN
        INSERT INTO portfolio (id, account_id, asset_id, amount, is_collateral)
        VALUES (gen_random_uuid(), test_account_id, eth_id, 3500000000000000000, true);
    END IF;

    -- XAUT: 1.5 = 1_500_000 (6 decimals) ~$7,495
    IF xaut_id IS NOT NULL THEN
        INSERT INTO portfolio (id, account_id, asset_id, amount, is_collateral)
        VALUES (gen_random_uuid(), test_account_id, xaut_id, 1500000, true);
    END IF;

    -- USDC: 5000 = 5_000_000_000 (6 decimals)
    INSERT INTO portfolio (id, account_id, asset_id, amount, is_collateral)
    VALUES (gen_random_uuid(), test_account_id, usdc_id, 5000000000, false);

    -- USDT: 2500 = 2_500_000_000 (6 decimals)
    INSERT INTO portfolio (id, account_id, asset_id, amount, is_collateral)
    VALUES (gen_random_uuid(), test_account_id, usdt_id, 2500000000, false);

    -- 6. Orders

    -- FILLED lend order 1: 5000 USDC at 4.5%
    INSERT INTO orders (id, account_id, asset_id, side, type, rate, quantity, filled_quantity, settlement_fee, status, created_at)
    VALUES (lend_order_1_id, test_account_id, usdc_id, 'LEND', 'LIMIT', 4.5, 5000000000, 5000000000, 0, 'FILLED', NOW() - INTERVAL '10 days');

    INSERT INTO order_markets (order_market_id, order_id, market_id)
    VALUES (om_lend_1, lend_order_1_id, usdc_market_30d_id);

    -- FILLED lend order 2: 3000 USDC at 5.0%
    INSERT INTO orders (id, account_id, asset_id, side, type, rate, quantity, filled_quantity, settlement_fee, status, created_at)
    VALUES (lend_order_2_id, test_account_id, usdc_id, 'LEND', 'LIMIT', 5.0, 3000000000, 3000000000, 0, 'FILLED', NOW() - INTERVAL '5 days');

    INSERT INTO order_markets (order_market_id, order_id, market_id)
    VALUES (om_lend_2, lend_order_2_id, usdc_market_90d_id);

    -- Counterparty FILLED borrow orders (matching the lend orders)
    INSERT INTO orders (id, account_id, asset_id, side, type, rate, quantity, filled_quantity, settlement_fee, status, created_at)
    VALUES (borrow_order_cp_1, counterparty_id, usdc_id, 'BORROW', 'LIMIT', 4.5, 5000000000, 5000000000, 0, 'FILLED', NOW() - INTERVAL '10 days');

    INSERT INTO order_markets (order_market_id, order_id, market_id)
    VALUES (om_borrow_cp_1, borrow_order_cp_1, usdc_market_30d_id);

    INSERT INTO orders (id, account_id, asset_id, side, type, rate, quantity, filled_quantity, settlement_fee, status, created_at)
    VALUES (borrow_order_cp_2, counterparty_id, usdc_id, 'BORROW', 'LIMIT', 5.0, 3000000000, 3000000000, 0, 'FILLED', NOW() - INTERVAL '5 days');

    INSERT INTO order_markets (order_market_id, order_id, market_id)
    VALUES (om_borrow_cp_2, borrow_order_cp_2, usdc_market_90d_id);

    -- User FILLED borrow order: 8000 USDT at 3.8%
    INSERT INTO orders (id, account_id, asset_id, side, type, rate, quantity, filled_quantity, settlement_fee, status, created_at)
    VALUES (borrow_order_user, test_account_id, usdt_id, 'BORROW', 'LIMIT', 3.8, 8000000000, 8000000000, 0, 'FILLED', NOW() - INTERVAL '7 days');

    INSERT INTO order_markets (order_market_id, order_id, market_id)
    VALUES (om_borrow_user, borrow_order_user, usdt_market_60d_id);

    -- Counterparty lend order matching user's borrow
    INSERT INTO orders (id, account_id, asset_id, side, type, rate, quantity, filled_quantity, settlement_fee, status, created_at)
    VALUES (lend_order_cp_usdt, counterparty_id, usdt_id, 'LEND', 'LIMIT', 3.8, 8000000000, 8000000000, 0, 'FILLED', NOW() - INTERVAL '7 days');

    INSERT INTO order_markets (order_market_id, order_id, market_id)
    VALUES (om_lend_cp_usdt, lend_order_cp_usdt, usdt_market_60d_id);

    -- OPEN lend orders
    INSERT INTO orders (id, account_id, asset_id, side, type, rate, quantity, filled_quantity, settlement_fee, status, created_at)
    VALUES
        (open_lend_1, test_account_id, usdc_id, 'LEND', 'LIMIT', 4.5, 500000000, 0, 0, 'OPEN', NOW() - INTERVAL '2 days'),
        (open_lend_2, test_account_id, usdc_id, 'LEND', 'LIMIT', 4.8, 750000000, 0, 0, 'OPEN', NOW() - INTERVAL '1 day'),
        (open_lend_3, test_account_id, usdc_id, 'LEND', 'LIMIT', 5.0, 1000000000, 0, 0, 'OPEN', NOW() - INTERVAL '3 hours');

    INSERT INTO order_markets (order_market_id, order_id, market_id)
    VALUES
        (gen_random_uuid(), open_lend_1, usdc_market_30d_id),
        (gen_random_uuid(), open_lend_2, usdc_market_30d_id),
        (gen_random_uuid(), open_lend_3, usdc_market_90d_id);

    -- OPEN borrow orders
    INSERT INTO orders (id, account_id, asset_id, side, type, rate, quantity, filled_quantity, settlement_fee, status, created_at)
    VALUES
        (open_borrow_1, test_account_id, usdt_id, 'BORROW', 'LIMIT', 3.5, 1000000000, 0, 0, 'OPEN', NOW() - INTERVAL '1 day'),
        (open_borrow_2, test_account_id, usdt_id, 'BORROW', 'LIMIT', 3.2, 500000000, 0, 0, 'OPEN', NOW() - INTERVAL '6 hours');

    INSERT INTO order_markets (order_market_id, order_id, market_id)
    VALUES
        (gen_random_uuid(), open_borrow_1, usdt_market_60d_id),
        (gen_random_uuid(), open_borrow_2, usdt_market_60d_id);

    -- PARTIALLY_FILLED lend order: 2000 USDC, 800 filled
    INSERT INTO orders (id, account_id, asset_id, side, type, rate, quantity, filled_quantity, settlement_fee, status, created_at)
    VALUES (partial_lend, test_account_id, usdc_id, 'LEND', 'LIMIT', 4.7, 2000000000, 800000000, 0, 'PARTIALLY_FILLED', NOW() - INTERVAL '4 days');

    INSERT INTO order_markets (order_market_id, order_id, market_id)
    VALUES (gen_random_uuid(), partial_lend, usdc_market_30d_id);

    -- 7. Matches
    -- Match 1: User lends 5000 USDC at 4.5%, 30-day maturity
    INSERT INTO matches (id, lend_order_market_id, borrow_order_market_id, asset_id, lender_account_id, borrower_account_id, match_amount, rate, is_borrower_taker, maker_fee, taker_fee, lender_settlement_fee, borrower_settlement_fee, maturity, created_at)
    VALUES (match_1_id, om_lend_1, om_borrow_cp_1, usdc_id, test_account_id, counterparty_id, 5000000000, 4.5, true, 0, 0.001, 0.005, 0.005, NOW() + INTERVAL '30 days', NOW() - INTERVAL '10 days');

    -- Match 2: User lends 3000 USDC at 5.0%, 90-day maturity
    INSERT INTO matches (id, lend_order_market_id, borrow_order_market_id, asset_id, lender_account_id, borrower_account_id, match_amount, rate, is_borrower_taker, maker_fee, taker_fee, lender_settlement_fee, borrower_settlement_fee, maturity, created_at)
    VALUES (match_2_id, om_lend_2, om_borrow_cp_2, usdc_id, test_account_id, counterparty_id, 3000000000, 5.0, true, 0, 0.001, 0.005, 0.005, NOW() + INTERVAL '90 days', NOW() - INTERVAL '5 days');

    -- Match 3: User borrows 8000 USDT at 3.8%, 60-day maturity
    INSERT INTO matches (id, lend_order_market_id, borrow_order_market_id, asset_id, lender_account_id, borrower_account_id, match_amount, rate, is_borrower_taker, maker_fee, taker_fee, lender_settlement_fee, borrower_settlement_fee, maturity, created_at)
    VALUES (match_3_id, om_lend_cp_usdt, om_borrow_user, usdt_id, counterparty_id, test_account_id, 8000000000, 3.8, true, 0, 0.001, 0.005, 0.005, NOW() + INTERVAL '60 days', NOW() - INTERVAL '7 days');

    -- 8. Lend Positions
    -- 5000 USDC: shares > amount to show accrued interest (APR = shares/amount - 1)
    INSERT INTO lend_positions (id, account_id, asset_id, market_id, shares, original_shares, amount, created_at)
    VALUES (gen_random_uuid(), test_account_id, usdc_id, usdc_market_30d_id, 5100000000, 5000000000, 5000000000, NOW() - INTERVAL '10 days');

    -- 3000 USDC: slight interest accrued
    INSERT INTO lend_positions (id, account_id, asset_id, market_id, shares, original_shares, amount, created_at)
    VALUES (gen_random_uuid(), test_account_id, usdc_id, usdc_market_90d_id, 3030000000, 3000000000, 3000000000, NOW() - INTERVAL '5 days');

    -- 9. Borrow Positions
    -- 8000 USDT: debt > original_debt to show accrued interest
    INSERT INTO borrow_positions (id, account_id, asset_id, market_id, amount, original_debt, debt, created_at)
    VALUES (gen_random_uuid(), test_account_id, usdt_id, usdt_market_60d_id, 8000000000, 8000000000, 8200000000, NOW() - INTERVAL '7 days');

    -- 10. Settlement Batch & Items
    INSERT INTO settlement_batches (id, tx_hash, status, created_at)
    VALUES (settlement_batch_id, '0xabc123def456789000000000000000000000000000000000000000000000dead', 'COMPLETED', NOW() - INTERVAL '10 days')
    ON CONFLICT DO NOTHING;

    INSERT INTO settlement_items (id, settlement_batch_id, match_id, created_at)
    VALUES (gen_random_uuid(), settlement_batch_id, match_1_id, NOW() - INTERVAL '10 days');

    -- 11. CBT Asset for USDC 30-day market
    IF NOT EXISTS (SELECT 1 FROM cbt_assets WHERE market_id = usdc_market_30d_id) THEN
        INSERT INTO cbt_assets (id, market_id, name, symbol, token_address, settlement_batch_id, created_at)
        VALUES (cbt_asset_id, usdc_market_30d_id, 'CBT USDC 30D', 'cbtUSDC30', '0xCBT0000000000000000000000000000000000001', settlement_batch_id, NOW() - INTERVAL '10 days');
    END IF;

    RAISE NOTICE 'Mock portfolio data seeded for wallet %', test_wallet;
END $$;

COMMIT;
