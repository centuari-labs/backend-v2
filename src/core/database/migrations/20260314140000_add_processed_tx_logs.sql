-- Migration: Add processed_tx_logs table for deposit deduplication
-- Tracks which (tx_hash, log_index) pairs have been processed to prevent double-counting.

-- +goose Up
CREATE TABLE IF NOT EXISTS processed_tx_logs (
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  event_name TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS idx_processed_tx_logs_event ON processed_tx_logs(event_name);

-- +goose Down
DROP TABLE IF EXISTS processed_tx_logs;
