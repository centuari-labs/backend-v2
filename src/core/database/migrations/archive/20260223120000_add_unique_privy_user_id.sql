-- +goose Up
ALTER TABLE accounts ADD CONSTRAINT uq_privy_user_id UNIQUE (privy_user_id);

-- +goose Down
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS uq_privy_user_id;
