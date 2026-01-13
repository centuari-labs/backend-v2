-- +goose Up
BEGIN;

-- 1. Orders Table Renames
ALTER TABLE orders RENAME COLUMN id TO order_id;
ALTER TABLE orders RENAME COLUMN asset_address TO loan_token;
ALTER TABLE orders RENAME COLUMN order_category TO side;
ALTER TABLE orders RENAME COLUMN order_type TO type;
ALTER TABLE orders RENAME COLUMN interest_rate TO rate;

-- 2. Drop unused columns
ALTER TABLE orders DROP COLUMN is_market_order;
ALTER TABLE orders DROP COLUMN limit_price;

-- 3. Add new columns
ALTER TABLE orders ADD COLUMN maturities INTEGER[];
ALTER TABLE orders ADD COLUMN "timestamp" BIGINT;
ALTER TABLE orders ADD COLUMN original_amount DECIMAL(36, 0);
ALTER TABLE orders ADD COLUMN remaining_amount DECIMAL(36, 0);
ALTER TABLE orders ADD COLUMN settlement_fee_amount DECIMAL(36, 0) DEFAULT 0;

-- 4. Data Migration (Best Effort)
-- Set timestamp to milliseconds
UPDATE orders SET "timestamp" = EXTRACT(EPOCH FROM created_at) * 1000;
-- Copy amounts (Truncating decimals if any, assuming integer units or user reset)
UPDATE orders SET original_amount = CAST(amount AS DECIMAL(36, 0));
UPDATE orders SET remaining_amount = CAST((amount - filled_amount) AS DECIMAL(36, 0));

-- 5. Set constraints
ALTER TABLE orders ALTER COLUMN original_amount SET NOT NULL;
ALTER TABLE orders ALTER COLUMN remaining_amount SET NOT NULL;
ALTER TABLE orders ALTER COLUMN settlement_fee_amount SET NOT NULL;

-- 6. Drop old columns
ALTER TABLE orders DROP COLUMN amount;
ALTER TABLE orders DROP COLUMN filled_amount;

-- 7. Order History Modifications
ALTER TABLE order_history RENAME COLUMN previous_filled_amount TO previous_remaining_amount;
ALTER TABLE order_history RENAME COLUMN new_filled_amount TO new_remaining_amount;
ALTER TABLE order_history ALTER COLUMN previous_remaining_amount TYPE DECIMAL(36, 0);
ALTER TABLE order_history ALTER COLUMN new_remaining_amount TYPE DECIMAL(36, 0);

COMMIT;

-- +goose Down
BEGIN;

-- 1. Revert Order History
ALTER TABLE order_history ALTER COLUMN new_remaining_amount TYPE DECIMAL(36, 18);
ALTER TABLE order_history ALTER COLUMN previous_remaining_amount TYPE DECIMAL(36, 18);
ALTER TABLE order_history RENAME COLUMN new_remaining_amount TO new_filled_amount;
ALTER TABLE order_history RENAME COLUMN previous_remaining_amount TO previous_filled_amount;

-- 2. Revert Orders Columns
ALTER TABLE orders ADD COLUMN filled_amount DECIMAL(36, 18);
ALTER TABLE orders ADD COLUMN amount DECIMAL(36, 18);
ALTER TABLE orders ADD COLUMN limit_price DECIMAL(36, 18);
ALTER TABLE orders ADD COLUMN is_market_order BOOLEAN DEFAULT false;

-- Data Revert
UPDATE orders SET amount = CAST(original_amount AS DECIMAL(36, 18));
UPDATE orders SET filled_amount = CAST((original_amount - remaining_amount) AS DECIMAL(36, 18));
ALTER TABLE orders ALTER COLUMN amount SET NOT NULL;
ALTER TABLE orders ALTER COLUMN filled_amount SET NOT NULL;

ALTER TABLE orders DROP COLUMN settlement_fee_amount;
ALTER TABLE orders DROP COLUMN remaining_amount;
ALTER TABLE orders DROP COLUMN original_amount;
ALTER TABLE orders DROP COLUMN "timestamp";
ALTER TABLE orders DROP COLUMN maturities;

ALTER TABLE orders RENAME COLUMN rate TO interest_rate;
ALTER TABLE orders RENAME COLUMN type TO order_type;
ALTER TABLE orders RENAME COLUMN side TO order_category;
ALTER TABLE orders RENAME COLUMN loan_token TO asset_address;
ALTER TABLE orders RENAME COLUMN order_id TO id;

COMMIT;
