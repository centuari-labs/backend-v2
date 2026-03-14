-- +goose Up
CREATE TABLE IF NOT EXISTS indexer_state (
  id VARCHAR(255) PRIMARY KEY,
  last_processed_block BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- +goose Down
DROP TABLE IF EXISTS indexer_state;
