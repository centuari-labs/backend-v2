-- +goose Up
-- Drop FK constraints on matches that reference order_markets.
-- The DB Writer currently inserts order IDs, not order_market IDs.
-- These constraints will be re-added once the data model is updated.
ALTER TABLE matches DROP CONSTRAINT IF EXISTS fk_lend_order_market;
ALTER TABLE matches DROP CONSTRAINT IF EXISTS fk_borrow_order_market;

-- +goose Down
ALTER TABLE matches ADD CONSTRAINT fk_lend_order_market
    FOREIGN KEY (lend_order_market_id) REFERENCES order_markets(order_market_id);
ALTER TABLE matches ADD CONSTRAINT fk_borrow_order_market
    FOREIGN KEY (borrow_order_market_id) REFERENCES order_markets(order_market_id);
