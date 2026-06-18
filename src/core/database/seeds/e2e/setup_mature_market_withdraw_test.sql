-- Seed: setup_mature_market_withdraw_test.sql
-- Creates a matured market with a lend position for E2E withdraw testing.
-- Also updates the USDC asset token_address to match the Anvil deployment.
-- Fully idempotent — safe to re-run.
--
-- Required psql variables (pass with -v):
--   :market_uuid      - Market UUID matching on-chain marketId (computed off-chain)
--   :maturity_iso     - Maturity as ISO timestamp, e.g. '2026-03-24 12:00:00+00'
--   :lender_wallet    - Lender wallet address (backend operator)
--   :cbt_amount       - CBT/shares amount in base units (e.g. 1000000000 for 1000 USDC)
--   :principal_amount - Principal in base units (same as cbt_amount when interest=0)
--   :usdc_address     - Mock USDC token address deployed on Anvil

BEGIN;

DO $$
DECLARE
    v_market_uuid   UUID    := :'market_uuid';
    v_maturity_iso  TEXT    := :'maturity_iso';
    v_lender_wallet TEXT    := :'lender_wallet';
    v_cbt_amount    NUMERIC := :'cbt_amount';
    v_principal     NUMERIC := :'principal_amount';
    v_usdc_address  TEXT    := :'usdc_address';

    v_asset_id      UUID;
    v_account_id    UUID;
BEGIN
    -- Find USDC asset by symbol
    SELECT id INTO v_asset_id FROM assets WHERE LOWER(symbol) = 'usdc' LIMIT 1;

    IF v_asset_id IS NULL THEN
        RAISE EXCEPTION 'USDC asset not found in assets table. Run the supported_tokens seed first.';
    END IF;

    -- Update USDC token_address to match the Anvil deployment
    -- (the seed has hardcoded Arbitrum Sepolia addresses; Anvil deploys to new addresses)
    UPDATE assets SET token_address = v_usdc_address WHERE id = v_asset_id;
    RAISE NOTICE 'Updated USDC asset % token_address to %', v_asset_id, v_usdc_address;

    -- Upsert account for lender wallet
    IF NOT EXISTS (SELECT 1 FROM accounts WHERE LOWER(user_wallet) = LOWER(v_lender_wallet)) THEN
        INSERT INTO accounts (id, privy_user_id, user_wallet)
        VALUES (gen_random_uuid(), 'did:privy:e2e-withdraw-' || LOWER(v_lender_wallet), v_lender_wallet);
        RAISE NOTICE 'Created account for wallet %', v_lender_wallet;
    END IF;

    SELECT id INTO v_account_id FROM accounts WHERE LOWER(user_wallet) = LOWER(v_lender_wallet);

    -- Upsert market with the specific UUID and past maturity
    INSERT INTO markets (id, asset_id, maturity, created_at)
    VALUES (v_market_uuid, v_asset_id, v_maturity_iso::TIMESTAMPTZ, NOW())
    ON CONFLICT (id) DO UPDATE SET
        maturity = EXCLUDED.maturity,
        asset_id = EXCLUDED.asset_id;

    RAISE NOTICE 'Upserted market % with maturity %', v_market_uuid, v_maturity_iso;

    -- Remove any pre-existing lend position for this account + market to keep idempotent
    DELETE FROM lend_positions
    WHERE account_id = v_account_id AND market_id = v_market_uuid;

    -- Insert lend position with shares = CBT amount
    INSERT INTO lend_positions (id, account_id, asset_id, market_id, shares, original_shares, amount, apr, created_at, updated_at)
    VALUES (
        gen_random_uuid(),
        v_account_id,
        v_asset_id,
        v_market_uuid,
        v_cbt_amount,
        v_cbt_amount,   -- original_shares = shares at creation
        v_principal,
        500,  -- 5% APR
        NOW(),
        NOW()
    );

    RAISE NOTICE 'Created lend position: shares=%, amount=%, market=%', v_cbt_amount, v_principal, v_market_uuid;

END $$;

COMMIT;
