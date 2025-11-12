import { writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
if (args.length === 0) {
    console.error(
        "❌ Please provide a migration name, e.g. npm run migrate:create create_users_table",
    );
    process.exit(1);
}

const name = args[0];
const timestamp = new Date()
    .toISOString()
    .replace(/[-T:.Z]/g, "")
    .slice(0, 14);
const filename = `${timestamp}_${name}.sql`;
const filePath = join(__dirname, "../migrations", filename);

const template = `-- Migration: ${filename}
-- +goose Up
BEGIN;

-- Example:
-- CREATE TABLE users (
--   id SERIAL PRIMARY KEY,
--   name VARCHAR(255) NOT NULL
-- );

COMMIT;

-- +goose Down
BEGIN;

-- Example rollback:
-- DROP TABLE IF EXISTS users;

COMMIT;
`;

writeFileSync(filePath, template);
console.log(`✅ Created migration: ${filename}`);
