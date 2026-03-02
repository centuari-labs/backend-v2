-- +goose Up
CREATE TABLE IF NOT EXISTS deposit_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tx_hash TEXT NOT NULL UNIQUE,
    asset_id UUID NOT NULL REFERENCES assets(id),
    account_id UUID NOT NULL REFERENCES accounts(id),
    amount NUMERIC NOT NULL,
    from_address TEXT NOT NULL,
    token_address TEXT NOT NULL,
    chain_id INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_deposit_transactions_tx_hash ON deposit_transactions(tx_hash);
CREATE INDEX idx_deposit_transactions_account_id ON deposit_transactions(account_id);

-- +goose Down
DROP TABLE IF EXISTS deposit_transactions;
