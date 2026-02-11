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

    DELETE FROM portfolio WHERE account_id = test_account_id;
    DELETE FROM orders WHERE account_id = test_account_id;

    IF usdc_id IS NOT NULL THEN
        INSERT INTO portfolio (id, account_id, asset_id, amount, is_collateral)
        VALUES (gen_random_uuid(), test_account_id, usdc_id, 1000000000.0, true);
        
        INSERT INTO portfolio (id, account_id, asset_id, amount, is_collateral)
        VALUES (gen_random_uuid(), test_account_id, usdc_id, -200000000.0, false);
    END IF;

    IF btc_id IS NOT NULL THEN
        INSERT INTO portfolio (id, account_id, asset_id, amount, is_collateral)
        VALUES (gen_random_uuid(), test_account_id, btc_id, 0.5, true);
    END IF;

    IF eth_id IS NOT NULL THEN
        INSERT INTO portfolio (id, account_id, asset_id, amount, is_collateral)
        VALUES (gen_random_uuid(), test_account_id, eth_id, 5.0, true);
    END IF;

    FOR i IN 1..117 LOOP
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
