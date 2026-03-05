-- Ensure order_markets.order_market_id has a proper UUID default so inserts
-- from OrderRepository.saveOrderWithMarkets never fail with a NULL id.

-- +goose Up

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

ALTER TABLE order_markets
    ALTER COLUMN order_market_id SET DEFAULT uuid_generate_v4();


-- +goose Down

ALTER TABLE order_markets
    ALTER COLUMN order_market_id DROP DEFAULT;

