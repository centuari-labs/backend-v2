-- Seed: 20260210221500_portfolio_test_data.sql
BEGIN;

DO $$
DECLARE
    test_account_id UUID;
    btc_id UUID;
    eth_id UUID;
    usdc_id UUID;
    usdt_id UUID;
    test_wallet TEXT := '0x71C7656EC7ab88b098defB751B7401B5f6d8976F';
BEGIN
    IF NOT EXISTS (SELECT 1 FROM accounts WHERE user_wallet = test_wallet) THEN
        INSERT INTO accounts (id, privy_user_id, user_wallet)
        VALUES (gen_random_uuid(), 'did:privy:cm1234567890', test_wallet);
    END IF;

    SELECT id INTO test_account_id FROM accounts WHERE user_wallet = test_wallet;

    SELECT id INTO btc_id FROM assets WHERE symbol = 'BTC' LIMIT 1;
    SELECT id INTO eth_id FROM assets WHERE symbol = 'ETH' LIMIT 1;
    SELECT id INTO usdc_id FROM assets WHERE symbol = 'USDC' LIMIT 1;
    SELECT id INTO usdt_id FROM assets WHERE symbol = 'USDT' LIMIT 1;

    -- All amounts in base units: BTC=8 decimals, ETH=18 decimals, USDC/USDT=6 decimals
    IF test_account_id IS NOT NULL THEN
        -- 0.0001 BTC = 10000 base units
        IF btc_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM portfolio WHERE account_id = test_account_id AND asset_id = btc_id AND is_collateral = true) THEN
            INSERT INTO portfolio (id, account_id, asset_id, amount, is_collateral)
            VALUES (gen_random_uuid(), test_account_id, btc_id, 10000, true);
        END IF;

        -- 0.0005 ETH = 500000000000000 base units
        IF eth_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM portfolio WHERE account_id = test_account_id AND asset_id = eth_id AND is_collateral = true) THEN
            INSERT INTO portfolio (id, account_id, asset_id, amount, is_collateral)
            VALUES (gen_random_uuid(), test_account_id, eth_id, 500000000000000, true);
        END IF;

        -- 50 USDC = 50000000 base units
        IF usdc_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM portfolio WHERE account_id = test_account_id AND asset_id = usdc_id AND amount > 0) THEN
            INSERT INTO portfolio (id, account_id, asset_id, amount, is_collateral)
            VALUES (gen_random_uuid(), test_account_id, usdc_id, 50000000, false);
        END IF;

        -- -10 USDC = -10000000 base units
        IF usdc_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM portfolio WHERE account_id = test_account_id AND asset_id = usdc_id AND amount < 0) THEN
            INSERT INTO portfolio (id, account_id, asset_id, amount, is_collateral)
            VALUES (gen_random_uuid(), test_account_id, usdc_id, -10000000, false);
        END IF;

        -- 1 USDC order = 1000000 base units
        IF usdc_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM orders WHERE account_id = test_account_id AND asset_id = usdc_id AND side = 'LEND' AND status = 'OPEN') THEN
            INSERT INTO orders (id, account_id, asset_id, side, type, rate, quantity, filled_quantity, settlement_fee, status)
            VALUES (gen_random_uuid(), test_account_id, usdc_id, 'LEND', 'LIMIT', 5.5, 1000000, 0, 0, 'OPEN');
        END IF;

        -- 0.0001 ETH = 100000000000000 base units
        IF eth_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM orders WHERE account_id = test_account_id AND asset_id = eth_id AND side = 'LEND' AND status = 'OPEN') THEN
            INSERT INTO orders (id, account_id, asset_id, side, type, rate, quantity, filled_quantity, settlement_fee, status)
            VALUES (gen_random_uuid(), test_account_id, eth_id, 'LEND', 'LIMIT', 3.2, 100000000000000, 0, 0, 'OPEN');
        END IF;

        -- 5 USDT = 5000000 base units
        IF usdt_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM orders WHERE account_id = test_account_id AND asset_id = usdt_id AND side = 'BORROW' AND status = 'OPEN') THEN
            INSERT INTO orders (id, account_id, asset_id, side, type, rate, quantity, filled_quantity, settlement_fee, status)
            VALUES (gen_random_uuid(), test_account_id, usdt_id, 'BORROW', 'LIMIT', 7.0, 5000000, 0, 0, 'OPEN');
        END IF;

        -- 3 USDC = 3000000 base units, filled 1 USDC = 1000000
        IF usdc_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM orders WHERE account_id = test_account_id AND asset_id = usdc_id AND side = 'BORROW' AND status = 'PARTIALLY_FILLED') THEN
            INSERT INTO orders (id, account_id, asset_id, side, type, rate, quantity, filled_quantity, settlement_fee, status)
            VALUES (gen_random_uuid(), test_account_id, usdc_id, 'BORROW', 'LIMIT', 6.5, 3000000, 1000000, 0, 'PARTIALLY_FILLED');
        END IF;

    END IF;

END $$;

COMMIT;
