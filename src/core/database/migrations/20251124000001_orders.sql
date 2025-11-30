CREATE TABLE order_groups (
    id SERIAL PRIMARY KEY,
    wallet_address VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    description TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create index for faster lookups by wallet address
CREATE INDEX idx_order_groups_wallet ON order_groups(wallet_address);
CREATE INDEX idx_order_groups_status ON order_groups(status);

-- Orders Table
CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    order_group_id INTEGER REFERENCES order_groups(id) ON DELETE SET NULL,
    wallet_address VARCHAR(255) NOT NULL,

    -- Order Type Information
    order_type VARCHAR(50) NOT NULL,
    order_category VARCHAR(50) NOT NULL,
    is_market_order BOOLEAN NOT NULL DEFAULT false,

    -- Order Details
    asset_address VARCHAR(255) NOT NULL,
    amount DECIMAL(36, 18) NOT NULL,

    -- Limit Order Specific Fields (NULL for market orders)
    limit_price DECIMAL(36, 18),
    limit_expiry TIMESTAMP,

    -- Interest Rate Information (for lending/borrowing)
    interest_rate DECIMAL(10, 6),
    duration_days INTEGER,

    -- Collateral Information (for borrow orders)
    collateral_asset_address VARCHAR(255),
    collateral_amount DECIMAL(36, 18),
    collateral_ratio DECIMAL(10, 6),

    -- Order Status
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    filled_amount DECIMAL(36, 18) NOT NULL DEFAULT 0,
    remaining_amount DECIMAL(36, 18) NOT NULL,

    -- Transaction Information
    transaction_hash VARCHAR(255),
    block_number BIGINT,

    -- Timestamps
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    filled_at TIMESTAMP,
    cancelled_at TIMESTAMP,

    -- Constraints
    CONSTRAINT positive_amount CHECK (amount > 0),
    CONSTRAINT positive_remaining CHECK (remaining_amount >= 0),
    CONSTRAINT positive_filled CHECK (filled_amount >= 0),
    CONSTRAINT filled_not_exceed_amount CHECK (filled_amount <= amount)
);

-- Create indexes for faster queries
CREATE INDEX idx_orders_wallet ON orders(wallet_address);
CREATE INDEX idx_orders_order_group ON orders(order_group_id);
CREATE INDEX idx_orders_type ON orders(order_type);
CREATE INDEX idx_orders_category ON orders(order_category);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_asset ON orders(asset_address);
CREATE INDEX idx_orders_created_at ON orders(created_at DESC);

-- Order History Table (for tracking order state changes)
CREATE TABLE order_history (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    previous_status VARCHAR(50),
    new_status VARCHAR(50) NOT NULL,
    previous_filled_amount DECIMAL(36, 18),
    new_filled_amount DECIMAL(36, 18),
    change_reason TEXT,
    transaction_hash VARCHAR(255),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_order_history_order_id ON order_history(order_id);
CREATE INDEX idx_order_history_created_at ON order_history(created_at DESC);

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
CREATE TRIGGER update_order_groups_updated_at BEFORE UPDATE ON order_groups
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_orders_updated_at ON orders;
DROP TRIGGER IF EXISTS update_order_groups_updated_at ON order_groups;
DROP FUNCTION IF EXISTS update_updated_at_column();
DROP TABLE IF EXISTS order_history CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS order_groups CASCADE;
