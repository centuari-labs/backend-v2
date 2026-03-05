-- Ensure orders.id has a proper UUID default so inserts from the
-- backend OrdersService/OrdersWorker never fail with a NULL id.

-- +goose Up

-- Use uuid-ossp since the backend already attempts to create this extension
-- on startup (`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"` in the logs).
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

ALTER TABLE orders
    ALTER COLUMN id SET DEFAULT uuid_generate_v4();


-- +goose Down

ALTER TABLE orders
    ALTER COLUMN id DROP DEFAULT;

