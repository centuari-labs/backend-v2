-- +goose Up
DO $$ BEGIN
    CREATE TYPE cancel_reason AS ENUM ('USER_CANCELLED', 'IOC');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancel_reason cancel_reason;

-- +goose Down
ALTER TABLE orders DROP COLUMN IF EXISTS cancel_reason;
DROP TYPE IF EXISTS cancel_reason;
