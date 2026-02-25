-- Seed: 20260225120000_rate_history_orders.sql
-- Seeds BORROW-side orders across multiple days for rate-history API testing.
-- References accounts and markets from prior seeds.

BEGIN;

DO $$
DECLARE
    acct_id UUID;
    usdc_id UUID;
    usdt_id UUID;
    usdc_market_id UUID;
    usdt_market_id UUID;
    order_id UUID;
    order_market_uuid UUID;
    base_date DATE := CURRENT_DATE - INTERVAL '14 days';
BEGIN
    -- Resolve existing account
    SELECT id INTO acct_id FROM accounts WHERE user_wallet = '0xcA2E021f8FEA9E3fb5F86A68A3158315404e6157' LIMIT 1;
    IF acct_id IS NULL THEN
        RAISE NOTICE 'No test account found, skipping rate-history seed';
        RETURN;
    END IF;

    -- Resolve existing assets
    SELECT id INTO usdc_id FROM assets WHERE symbol = 'USDC' AND is_loan_token = true LIMIT 1;
    SELECT id INTO usdt_id FROM assets WHERE symbol = 'USDT' AND is_loan_token = true LIMIT 1;

    -- Resolve or create markets
    IF usdc_id IS NOT NULL THEN
        SELECT id INTO usdc_market_id FROM markets WHERE asset_id = usdc_id LIMIT 1;
        IF usdc_market_id IS NULL THEN
            usdc_market_id := gen_random_uuid();
            INSERT INTO markets (id, asset_id, maturity, created_at)
            VALUES (usdc_market_id, usdc_id, NOW() + INTERVAL '90 days', NOW());
        END IF;
    END IF;

    IF usdt_id IS NOT NULL THEN
        SELECT id INTO usdt_market_id FROM markets WHERE asset_id = usdt_id LIMIT 1;
        IF usdt_market_id IS NULL THEN
            usdt_market_id := gen_random_uuid();
            INSERT INTO markets (id, asset_id, maturity, created_at)
            VALUES (usdt_market_id, usdt_id, NOW() + INTERVAL '90 days', NOW());
        END IF;
    END IF;

    -- USDC BORROW orders: 14 days, multiple orders per day with varying rates
    -- The MIN(rate) per day will form the rate-history curve
    IF usdc_market_id IS NOT NULL THEN
        FOR day_offset IN 0..13 LOOP
            -- Order 1: lower rate (will be the "best" for that day)
            order_id := gen_random_uuid();
            order_market_uuid := gen_random_uuid();
            INSERT INTO orders (id, account_id, asset_id, side, type, rate, quantity, filled_quantity, settlement_fee, status, created_at)
            VALUES (
                order_id, acct_id, usdc_id, 'BORROW'::order_side, 'LIMIT'::order_type,
                0.05 + (day_offset * 0.005),    -- rates from 0.05 to 0.115
                10000000, 0, 0,
                CASE day_offset % 3
                    WHEN 0 THEN 'OPEN'::order_status
                    WHEN 1 THEN 'FILLED'::order_status
                    ELSE 'PARTIALLY_FILLED'::order_status
                END,
                (base_date + day_offset) + TIME '10:00:00'
            );
            INSERT INTO order_markets (order_market_id, order_id, market_id)
            VALUES (order_market_uuid, order_id, usdc_market_id);

            -- Order 2: higher rate (should NOT appear as best rate)
            order_id := gen_random_uuid();
            order_market_uuid := gen_random_uuid();
            INSERT INTO orders (id, account_id, asset_id, side, type, rate, quantity, filled_quantity, settlement_fee, status, created_at)
            VALUES (
                order_id, acct_id, usdc_id, 'BORROW'::order_side, 'LIMIT'::order_type,
                0.08 + (day_offset * 0.005),    -- always higher than order 1
                5000000, 5000000, 0, 'FILLED'::order_status,
                (base_date + day_offset) + TIME '14:00:00'
            );
            INSERT INTO order_markets (order_market_id, order_id, market_id)
            VALUES (order_market_uuid, order_id, usdc_market_id);
        END LOOP;
    END IF;

    -- USDT BORROW orders: 7 days for second market
    IF usdt_market_id IS NOT NULL THEN
        FOR day_offset IN 0..6 LOOP
            order_id := gen_random_uuid();
            order_market_uuid := gen_random_uuid();
            INSERT INTO orders (id, account_id, asset_id, side, type, rate, quantity, filled_quantity, settlement_fee, status, created_at)
            VALUES (
                order_id, acct_id, usdt_id, 'BORROW'::order_side, 'LIMIT'::order_type,
                0.06 + (day_offset * 0.004),
                20000000, 0, 0,
                CASE day_offset % 2
                    WHEN 0 THEN 'OPEN'::order_status
                    ELSE 'PARTIALLY_FILLED'::order_status
                END,
                (base_date + day_offset) + TIME '12:00:00'
            );
            INSERT INTO order_markets (order_market_id, order_id, market_id)
            VALUES (order_market_uuid, order_id, usdt_market_id);
        END LOOP;
    END IF;

    RAISE NOTICE 'Rate-history seed complete: 28 USDC orders (14 days) + 7 USDT orders (7 days)';
END $$;

COMMIT;
