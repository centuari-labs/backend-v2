-- Seed: 20260225000000_seed_portfolio_collateral.sql
-- 1. Sets avg_ltv (basis points) on collateral assets from the risk table
-- 2. Seeds portfolio collateral for ALL existing accounts
--
-- Health factor code expects:
--   - assets.avg_ltv in basis points (7500 = 75%), divides by 10,000
--   - portfolio.amount as integer base units (1 BTC @ 18 decimals = 1e18)

BEGIN;

-- ─── Step 1: Populate avg_ltv on collateral assets ───────────────────
-- The risk table stores LTV as decimals (0.75 = 75%).
-- The health factor code expects basis points (7500 = 75%).
-- Compute average LTV across all loan pairings per collateral asset.
UPDATE assets
SET avg_ltv = sub.avg_ltv_bps
FROM (
    SELECT
        r.collateral_token_id,
        AVG(r.ltv) * 10000 AS avg_ltv_bps  -- decimal → basis points
    FROM risk r
    GROUP BY r.collateral_token_id
) sub
WHERE assets.id = sub.collateral_token_id
  AND assets.is_loan_token = false;

-- ─── Step 2: Seed portfolio collateral per account ───────────────────
DO $$
DECLARE
    acct RECORD;
    asset RECORD;
    base_amount NUMERIC;
    human_amount NUMERIC;
BEGIN
    FOR acct IN SELECT id, user_wallet FROM accounts LOOP

        FOR asset IN
            SELECT id, symbol, decimals, avg_ltv
            FROM assets
            WHERE is_loan_token = false
              AND decimals IS NOT NULL
        LOOP
            -- Skip if already has collateral for this asset
            IF EXISTS (
                SELECT 1 FROM portfolio
                WHERE account_id = acct.id
                  AND asset_id = asset.id
                  AND is_collateral = true
            ) THEN
                CONTINUE;
            END IF;

            -- Enough collateral to support worker borrow orders ($100-$5000)
            -- Each asset provides ~$10,000-$15,000 worth of collateral
            human_amount := CASE asset.symbol
                WHEN 'BTC'    THEN 0.15    -- ~$12,000 at $80k
                WHEN 'ETH'    THEN 5.0     -- ~$15,000 at $3k
                WHEN 'XAUT'   THEN 5.0     -- ~$15,000 at $3k
                WHEN 'SLVon'  THEN 500.0   -- ~$15,000 at $30
                WHEN 'NVDAon' THEN 100.0   -- ~$12,000 at $120
                WHEN 'AAPLon' THEN 60.0    -- ~$12,000 at $200
                WHEN 'TLTon'  THEN 150.0   -- ~$12,000 at $80
                ELSE 10.0
            END;

            -- Convert to base units: human_amount * 10^decimals
            base_amount := human_amount * power(10, asset.decimals);

            INSERT INTO portfolio (id, account_id, asset_id, amount, is_collateral)
            VALUES (gen_random_uuid(), acct.id, asset.id, base_amount, true);

            RAISE NOTICE 'Seeded % % (% base units, avg_ltv=%) for %',
                human_amount, asset.symbol, base_amount, asset.avg_ltv, acct.user_wallet;
        END LOOP;

    END LOOP;
END $$;

COMMIT;
