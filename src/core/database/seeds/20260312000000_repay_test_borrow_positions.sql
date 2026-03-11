-- Seed: 20260312000000_repay_test_borrow_positions.sql
-- Seeds borrow positions for repay endpoint testing.
-- Supports multiple test wallet addresses. Fully idempotent.

BEGIN;

DO $$
DECLARE
    test_wallet        TEXT;
    test_account_id    UUID;
    target_asset_id    UUID := 'ac7ae153-ad3f-44aa-96e7-44c8d22e84ab';
    target_market_id   UUID;
    target_decimals    INT;
    -- 100 tokens in base units, resolved after we know decimals
    debt_base_units    NUMERIC;
    wallets            TEXT[] := ARRAY[
        -- Add your wallet addresses here
        '0x3Ebf8ffC3F1517f9760dD2BfF36f934d19fa6cD8',
        '0x44a95B161A038de26cB16A45CC2580685176D966',
        '0x52b0f78ca732389f96539e8E3E0d02F2796D8bac',
        '0x477Dcb9AE26E73C42D1a0172c1c216f38316EfE1'
    ];
BEGIN
    -- Resolve asset decimals
    SELECT COALESCE(decimals, 18) INTO target_decimals
    FROM assets WHERE id = target_asset_id;

    IF NOT FOUND THEN
        RAISE NOTICE 'Asset % not found, skipping seed.', target_asset_id;
        RETURN;
    END IF;

    -- 100 tokens in base units (e.g. 100_000_000 for 6-decimal USDC)
    debt_base_units := 100 * POWER(10, target_decimals);

    -- Resolve or create a market for this asset with a specific maturity
    -- Avoid NULL markets that might have been created by mistake
    SELECT id INTO target_market_id 
    FROM markets 
    WHERE asset_id = target_asset_id AND maturity IS NOT NULL
    ORDER BY maturity DESC
    LIMIT 1;

    IF target_market_id IS NULL THEN
        target_market_id := gen_random_uuid();
        -- Use a fixed maturity for predictable testing (e.g., 2026-12-31)
        INSERT INTO markets (id, asset_id, maturity, created_at)
        VALUES (target_market_id, target_asset_id, '2026-12-31 00:00:00+00', NOW());
        RAISE NOTICE 'Created test market % for asset % with maturity 2026-12-31', target_market_id, target_asset_id;
    END IF;

    -- Iterate over test wallets
    FOREACH test_wallet IN ARRAY wallets LOOP

        -- Upsert account
        IF NOT EXISTS (SELECT 1 FROM accounts WHERE LOWER(user_wallet) = LOWER(test_wallet)) THEN
            INSERT INTO accounts (id, privy_user_id, user_wallet)
            VALUES (gen_random_uuid(), 'did:privy:repay-seed-' || LOWER(test_wallet), test_wallet);
            RAISE NOTICE 'Created account for wallet %', test_wallet;
        END IF;

        SELECT id INTO test_account_id FROM accounts WHERE LOWER(user_wallet) = LOWER(test_wallet);

        -- Remove any pre-existing borrow position for this asset to keep the seed idempotent
        DELETE FROM borrow_positions
        WHERE account_id = test_account_id AND asset_id = target_asset_id;

        -- Insert fresh borrow position: 100 tokens of debt
        INSERT INTO borrow_positions (id, account_id, asset_id, market_id, amount, original_debt, debt, created_at)
        VALUES (
            gen_random_uuid(),
            test_account_id,
            target_asset_id,
            target_market_id,
            debt_base_units,  -- amount (principal)
            debt_base_units,  -- original_debt
            debt_base_units,  -- current debt
            NOW()
        );

        RAISE NOTICE 'Inserted borrow position for wallet % — % base units of asset %',
            test_wallet, debt_base_units, target_asset_id;
    END LOOP;
END $$;

COMMIT;
