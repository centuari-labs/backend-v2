-- +goose Up
BEGIN;

-- Enable pgcrypto for UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create order_groups (kept for compatibility if needed, but simplified)
CREATE TABLE order_groups (
    id SERIAL PRIMARY KEY,
    wallet_address VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Orders Table with UUID
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_group_id INTEGER REFERENCES order_groups(id) ON DELETE SET NULL,
    wallet_address VARCHAR(255) NOT NULL,
    
    order_type VARCHAR(50) NOT NULL,
    order_category VARCHAR(50) NOT NULL,
    is_market_order BOOLEAN NOT NULL DEFAULT false,
    
    asset_address VARCHAR(255) NOT NULL,
    amount DECIMAL(36, 18) NOT NULL,
    
    limit_price DECIMAL(36, 18),
    interest_rate INT, -- Changed to INT to match Entity
    
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    filled_amount DECIMAL(36, 18) NOT NULL DEFAULT 0,
    
    transaction_hash VARCHAR(255),
    block_number BIGINT,
    
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    filled_at TIMESTAMP,
    cancelled_at TIMESTAMP
);

-- Indices
CREATE INDEX idx_orders_wallet ON orders(wallet_address);
CREATE INDEX idx_orders_type ON orders(order_type);
CREATE INDEX idx_orders_category ON orders(order_category);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_asset ON orders(asset_address);

-- Order History Table (ID matches Order UUID)
CREATE TABLE order_history (
    id SERIAL PRIMARY KEY,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    previous_status VARCHAR(50),
    new_status VARCHAR(50) NOT NULL,
    previous_filled_amount DECIMAL(36, 18),
    new_filled_amount DECIMAL(36, 18),
    change_reason TEXT,
    transaction_hash VARCHAR(255),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_order_history_order_id ON order_history(order_id);

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMIT;

-- +goose Down
BEGIN;

DROP TRIGGER IF EXISTS update_orders_updated_at ON orders;
DROP FUNCTION IF EXISTS update_updated_at_column();
DROP TABLE IF EXISTS order_history CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS order_groups CASCADE;

COMMIT;
