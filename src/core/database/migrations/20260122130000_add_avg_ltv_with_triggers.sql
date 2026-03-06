-- Migration: Add avg_ltv column to assets table with triggers
-- This migration adds avg_ltv column and creates triggers to automatically maintain it

-- +goose Up

-- Step 1: Add avg_ltv column to assets table
ALTER TABLE assets ADD COLUMN IF NOT EXISTS avg_ltv NUMERIC;

-- Step 2: Create trigger function to update avg_ltv for a loan token
CREATE OR REPLACE FUNCTION update_avg_ltv()
RETURNS TRIGGER AS $$
DECLARE
    affected_loan_token_id UUID;
BEGIN
    -- Determine which loan_token_id was affected
    IF TG_OP = 'INSERT' THEN
        affected_loan_token_id := NEW.loan_token_id;
    ELSIF TG_OP = 'UPDATE' THEN
        -- Handle both old and new loan_token_id in case it changed
        IF OLD.loan_token_id IS DISTINCT FROM NEW.loan_token_id THEN
            -- Update avg_ltv for old loan token
            UPDATE assets
            SET avg_ltv = (
                SELECT AVG(ltv)::numeric
                FROM risk
                WHERE loan_token_id = OLD.loan_token_id
            )
            WHERE id = OLD.loan_token_id;
            
            -- Update avg_ltv for new loan token
            affected_loan_token_id := NEW.loan_token_id;
        ELSE
            -- loan_token_id didn't change, just update for this token
            affected_loan_token_id := NEW.loan_token_id;
        END IF;
    ELSIF TG_OP = 'DELETE' THEN
        affected_loan_token_id := OLD.loan_token_id;
    END IF;

    -- Update avg_ltv for the affected loan token
    UPDATE assets
    SET avg_ltv = (
        SELECT AVG(ltv)::numeric
        FROM risk
        WHERE loan_token_id = affected_loan_token_id
    )
    WHERE id = affected_loan_token_id;

    -- Return appropriate record based on operation
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Step 3: Create triggers for INSERT, UPDATE, and DELETE operations
CREATE TRIGGER risk_insert_trigger
    AFTER INSERT ON risk
    FOR EACH ROW
    EXECUTE FUNCTION update_avg_ltv();

CREATE TRIGGER risk_update_trigger
    AFTER UPDATE ON risk
    FOR EACH ROW
    EXECUTE FUNCTION update_avg_ltv();

CREATE TRIGGER risk_delete_trigger
    AFTER DELETE ON risk
    FOR EACH ROW
    EXECUTE FUNCTION update_avg_ltv();

-- Step 4: Populate initial avg_ltv values for existing loan tokens
UPDATE assets
SET avg_ltv = (
    SELECT AVG(ltv)::numeric
    FROM risk
    WHERE loan_token_id = assets.id
)
WHERE is_loan_token = true;

-- +goose Down

-- Drop triggers
DROP TRIGGER IF EXISTS risk_delete_trigger ON risk;
DROP TRIGGER IF EXISTS risk_update_trigger ON risk;
DROP TRIGGER IF EXISTS risk_insert_trigger ON risk;

-- Drop function
DROP FUNCTION IF EXISTS update_avg_ltv();

-- Drop column
ALTER TABLE assets DROP COLUMN IF EXISTS avg_ltv;
