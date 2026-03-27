-- Seed: 20260324000000_loan_token_collateral_risk.sql
-- Add risk params for loan tokens used as collateral for other loan tokens.
-- Same-token pairs (e.g. USDC→USDC) get higher LTV since there's no price risk.
-- Cross-stablecoin pairs (e.g. USDC→USDT) get slightly lower LTV for peg risk.
BEGIN;

INSERT INTO risk (id, collateral_token_id, loan_token_id, ltv, lt, lp)
SELECT
    gen_random_uuid(),
    collateral.id,
    loan.id,
    CASE WHEN collateral.id = loan.id THEN 9000 ELSE 8500 END,
    CASE WHEN collateral.id = loan.id THEN 9300 ELSE 8800 END,
    500
FROM assets collateral
CROSS JOIN assets loan
WHERE collateral.is_loan_token = true
  AND loan.is_loan_token = true
ON CONFLICT (collateral_token_id, loan_token_id) DO NOTHING;

COMMIT;
